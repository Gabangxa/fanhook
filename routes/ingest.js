const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifySignature } = require('../lib/verify');
const { fanout } = require('../lib/fanout');
const { getMonthlyEventCount, getEventLimit } = require('../lib/metering');
const natsLib = require('../lib/nats');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /ingest/:sinkId
// Note: express.raw({type: '*/*'}) is applied in server.js before this router
// so req.body will be a Buffer containing the raw request body.
// ---------------------------------------------------------------------------
router.post('/:sinkId', async (req, res) => {
  const { sinkId } = req.params;

  const sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(sinkId);
  if (!sink) {
    return res.status(404).json({ error: 'Sink not found' });
  }

  // ---------------------------------------------------------------------------
  // Usage enforcement — block Free-tier sinks that have hit their monthly cap
  // ---------------------------------------------------------------------------
  const tier = sink.tier || 'free';
  const used = getMonthlyEventCount(db, sinkId);
  const limit = getEventLimit(tier);

  if (used >= limit) {
    return res.status(429).json({
      error: 'Monthly event limit reached',
      tier,
      events_used: used,
      events_limit: limit,
      upgrade_url: '/dashboard#upgrade',
      message: `Your ${tier} plan allows ${limit.toLocaleString()} events/month. Upgrade at /dashboard to continue.`,
    });
  }

  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(req.body || '{}');
  const rawBodyStr = rawBody.toString('utf8');

  // Verify signature — skip strict check for generic providers
  const { valid, error } = verifySignature(sink.provider, rawBodyStr, req.headers, sink.webhook_secret);
  if (!valid && sink.provider !== 'generic') {
    return res.status(401).json({ error: `Signature verification failed: ${error}` });
  }

  // Create event record
  const eventId = uuidv4();
  const receivedAt = new Date().toISOString();
  const payload = rawBodyStr || '{}';

  db.prepare(`
    INSERT INTO events (id, sink_id, provider, payload, received_at, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, sinkId, sink.provider, payload, receivedAt, 'pending');

  // Publish real-time status event to NATS core so SSE subscribers see the new
  // event immediately. Best-effort — never blocks the ingest response.
  natsLib.publishStatusEvent(sinkId, {
    event_id: eventId,
    sink_id: sinkId,
    status: 'pending',
    received_at: receivedAt,
  }).catch(() => {});

  // Look up all routes for this sink
  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);

  if (routes.length === 0) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    // Publish final status so SSE subscribers don't stay stuck on 'pending'
    natsLib.publishStatusEvent(sinkId, {
      event_id: eventId,
      sink_id: sinkId,
      status: 'failed',
    }).catch(() => {});
    return res.status(200).json({ received: true, routed: 0 });
  }

  // ---------------------------------------------------------------------------
  // Fanout dispatch: always attempt NATS JetStream (default: nats://localhost:4222).
  // On publish failure (NATS unavailable), fall back to direct in-process fanout
  // so ingest remains reliable regardless of NATS availability.
  // ---------------------------------------------------------------------------
  let deliveryMode = 'direct';
  try {
    await natsLib.publish(sinkId, {
      eventId,
      sinkId,
      rawBodyB64: rawBody.toString('base64'),
      headers: req.headers,
    });
    deliveryMode = 'nats';
    console.log(`[ingest] Published event ${eventId} to NATS (sink ${sinkId})`);
  } catch (err) {
    console.warn(`[ingest] NATS unavailable for event ${eventId} — using direct fanout: ${err.message}`);
    fanout(db, eventId, routes, rawBody, req.headers).catch(() => {});
  }

  return res.status(200).json({
    received: true,
    routed: routes.length,
    event_id: eventId,
    delivery_mode: deliveryMode,
  });
});

module.exports = router;
