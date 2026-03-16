const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifySignature } = require('../lib/verify');
const { fanout } = require('../lib/fanout');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /ingest/:sinkId
// Note: express.raw({type: '*/*'}) is applied in server.js before this router
// so req.body will be a Buffer containing the raw request body.
// ---------------------------------------------------------------------------
router.post('/:sinkId', (req, res) => {
  const { sinkId } = req.params;

  const sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(sinkId);
  if (!sink) {
    return res.status(404).json({ error: 'Sink not found' });
  }

  const rawBodyStr = req.body ? req.body.toString('utf8') : '';

  // Verify signature — skip strict check for generic providers
  const { valid, error } = verifySignature(sink.provider, rawBodyStr, req.headers, null);
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

  // Look up all routes for this sink
  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);

  if (routes.length === 0) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    return res.status(200).json({ received: true, routed: 0 });
  }

  // Fire-and-forget fanout — do NOT await
  fanout(db, eventId, routes, req.body, req.headers).catch(() => {
    // Errors are handled inside fanout; this prevents unhandled rejections
  });

  return res.status(200).json({
    received: true,
    routed: routes.length,
    event_id: eventId,
  });
});

module.exports = router;
