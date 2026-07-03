const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifySignature } = require('../lib/verify');
const { getMonthlyEventCount, getEventLimit } = require('../lib/metering');
const natsLib = require('../lib/nats');
const outbox = require('../lib/outbox');

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
    // 400 for malformed/missing signature headers (client error in framing);
    // 401 only for cryptographic mismatches (auth failure).
    const errStr = String(error || '');
    const isFramingError =
      /^Missing /.test(errStr) ||
      /format/i.test(errStr) ||
      /Verification error/i.test(errStr);
    const status = isFramingError ? 400 : 401;
    return res.status(status).json({ error: `Signature verification failed: ${error}` });
  }

  // Create event record + durable outbox row in a single transaction.
  // The outbox row guarantees delivery even if the process crashes before the
  // NATS publish (or the in-process fallback) completes. On a successful NATS
  // publish it is removed — JetStream owns delivery from that point.
  const eventId = uuidv4();
  const receivedAt = new Date().toISOString();
  const payload = rawBodyStr || '{}';
  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO events (id, sink_id, provider, payload, received_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, sinkId, sink.provider, payload, receivedAt, 'pending');

    if (routes.length > 0) {
      // Not yet due (two-phase handoff): the row only becomes eligible for
      // the sweeper if the NATS publish below fails (arm) or the process
      // crashes before the handoff completes (grace window elapses).
      outbox.enqueue(db, {
        eventId,
        sinkId,
        rawBodyB64: rawBody.toString('base64'),
        headers: req.headers,
        delayMs: outbox.PENDING_GRACE_MS,
      });
    }
  })();

  // Publish real-time status event to NATS core so SSE subscribers see the new
  // event immediately. Best-effort — never blocks the ingest response.
  natsLib.publishStatusEvent(sinkId, {
    event_id: eventId,
    sink_id: sinkId,
    status: 'pending',
    received_at: receivedAt,
  }).catch(() => {});

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
  // On publish success, the outbox row is removed (JetStream owns delivery).
  // On failure (NATS unavailable), the outbox row stays and the durable sweeper
  // delivers it — no fire-and-forget, no events silently stuck on crash.
  // ---------------------------------------------------------------------------
  let deliveryMode = 'outbox';
  try {
    await natsLib.publish(sinkId, {
      eventId,
      sinkId,
      rawBodyB64: rawBody.toString('base64'),
      headers: req.headers,
    });
    deliveryMode = 'nats';
    outbox.remove(db, eventId);
    console.log(`[ingest] Published event ${eventId} to NATS (sink ${sinkId})`);
  } catch (err) {
    console.warn(`[ingest] NATS unavailable for event ${eventId} — durable outbox delivery: ${err.message}`);
    outbox.arm(db, eventId);
    outbox.notify();
  }

  return res.status(200).json({
    received: true,
    routed: routes.length,
    event_id: eventId,
    delivery_mode: deliveryMode,
  });
});

module.exports = router;
