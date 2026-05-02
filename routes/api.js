const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getMonthlyEventCount, getEventLimit } = require('../lib/metering');
const { fanout } = require('../lib/fanout');
const natsLib = require('../lib/nats');

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth middleware — validates Bearer token, attaches req.sink
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const sink = db.prepare('SELECT * FROM sinks WHERE api_key = ?').get(token);
  if (!sink) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.sink = sink;
  next();
}

// For routes that also take :sinkId — verify the sink belongs to the bearer
function requireSinkAuth(req, res, next) {
  requireAuth(req, res, () => {
    if (req.sink.id !== req.params.sinkId) {
      return res.status(403).json({ error: 'Forbidden: sink does not belong to this API key' });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// POST /api/sinks — create a new sink (no auth required — self-service registration)
// ---------------------------------------------------------------------------
router.post('/sinks', (req, res) => {
  const { name, provider = 'generic', webhook_secret } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const VALID_PROVIDERS = ['stripe', 'github', 'generic'];
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }

  if ((provider === 'stripe' || provider === 'github') && !webhook_secret) {
    return res.status(400).json({ error: `webhook_secret is required for provider '${provider}'` });
  }

  const sinkId = uuidv4();
  const apiKey = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO sinks (id, name, provider, api_key, webhook_secret, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sinkId, name, provider, apiKey, webhook_secret || null, createdAt);

  return res.status(201).json({
    sink_id: sinkId,
    ingest_url: `/ingest/${sinkId}`,
    api_key: apiKey,
    webhook_secret: webhook_secret || null,
  });
});

// ---------------------------------------------------------------------------
// GET /api/sinks — list sinks for the authenticated API key
// ---------------------------------------------------------------------------
router.get('/sinks', requireAuth, (req, res) => {
  // A single api_key maps to one sink in this model; return as array for API consistency
  const sinks = db.prepare('SELECT * FROM sinks WHERE api_key = ?').all(req.sink.api_key);
  return res.json(sinks);
});

// ---------------------------------------------------------------------------
// GET /api/sinks/:sinkId/events — last 50 events with delivery attempts
// ---------------------------------------------------------------------------
router.get('/sinks/:sinkId/events', requireSinkAuth, (req, res) => {
  const events = db
    .prepare(
      `SELECT * FROM events WHERE sink_id = ? ORDER BY received_at DESC LIMIT 50`
    )
    .all(req.params.sinkId);

  const enriched = events.map((evt) => {
    const attempts = db
      .prepare(
        `SELECT * FROM delivery_attempts WHERE event_id = ? ORDER BY attempt_number ASC`
      )
      .all(evt.id);
    return { ...evt, delivery_attempts: attempts };
  });

  return res.json(enriched);
});

// ---------------------------------------------------------------------------
// GET /api/sinks/:sinkId/routes — list routes for a sink
// ---------------------------------------------------------------------------
router.get('/sinks/:sinkId/routes', requireSinkAuth, (req, res) => {
  const routes = db
    .prepare('SELECT * FROM routes WHERE sink_id = ? ORDER BY created_at ASC')
    .all(req.params.sinkId);
  return res.json(routes);
});

// ---------------------------------------------------------------------------
// POST /api/sinks/:sinkId/routes — add a route to a sink
// ---------------------------------------------------------------------------
router.post('/sinks/:sinkId/routes', requireSinkAuth, (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'url must start with http:// or https://' });
  }

  const routeId = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO routes (id, sink_id, url, created_at)
    VALUES (?, ?, ?, ?)
  `).run(routeId, req.params.sinkId, url, createdAt);

  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
  return res.status(201).json(route);
});

// ---------------------------------------------------------------------------
// DELETE /api/sinks/:sinkId/routes/:routeId — remove a route
// ---------------------------------------------------------------------------
router.delete('/sinks/:sinkId/routes/:routeId', requireSinkAuth, (req, res) => {
  const route = db
    .prepare('SELECT * FROM routes WHERE id = ? AND sink_id = ?')
    .get(req.params.routeId, req.params.sinkId);

  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }

  db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.routeId);
  return res.status(204).send();
});

// ---------------------------------------------------------------------------
// GET /api/sinks/:sinkId/dlq — list last 50 undriven DLQ entries for a sink
// ---------------------------------------------------------------------------
router.get('/sinks/:sinkId/dlq', requireSinkAuth, (req, res) => {
  const entries = db
    .prepare(
      `SELECT * FROM dlq_entries
       WHERE sink_id = ? AND redriven = 0
       ORDER BY failed_at DESC LIMIT 50`
    )
    .all(req.params.sinkId);
  return res.json(entries);
});

// ---------------------------------------------------------------------------
// POST /api/sinks/:sinkId/dlq/:eventId/redrive — redrive a DLQ entry
// ---------------------------------------------------------------------------
router.post('/sinks/:sinkId/dlq/:eventId/redrive', requireSinkAuth, async (req, res) => {
  const { sinkId, eventId } = req.params;

  const entry = db
    .prepare('SELECT * FROM dlq_entries WHERE event_id = ? AND sink_id = ?')
    .get(eventId, sinkId);

  if (!entry) {
    return res.status(404).json({ error: 'DLQ entry not found' });
  }

  if (entry.redriven) {
    return res.status(409).json({ error: 'Entry has already been redriven', new_event_id: entry.new_event_id });
  }

  const sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(sinkId);
  if (!sink) {
    return res.status(404).json({ error: 'Sink not found' });
  }

  const newEventId = uuidv4();
  const receivedAt = new Date().toISOString();
  const rawBody = Buffer.from(entry.raw_body_b64 || '', 'base64');
  let originalHeaders = {};
  try { originalHeaders = JSON.parse(entry.headers || '{}'); } catch (_) {}
  const payload = rawBody.toString('utf8') || '{}';

  // Create a fresh event record so the redriven delivery appears in the event log
  db.prepare(`
    INSERT INTO events (id, sink_id, provider, payload, received_at, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newEventId, sinkId, entry.provider || sink.provider, payload, receivedAt, 'pending');

  // Mark DLQ entry as redriven immediately so a double-click can't fire twice
  db.prepare(
    'UPDATE dlq_entries SET redriven = 1, redriven_at = ?, new_event_id = ? WHERE event_id = ?'
  ).run(receivedAt, newEventId, eventId);

  // Dispatch the redriven event via NATS (preferred) or direct fanout (fallback)
  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);
  if (routes.length > 0) {
    try {
      await natsLib.publish(sinkId, {
        eventId: newEventId,
        sinkId,
        rawBodyB64: entry.raw_body_b64 || '',
        headers: originalHeaders,
      });
    } catch (_) {
      // NATS unavailable — fall back to in-process fanout
      fanout(db, newEventId, routes, rawBody, originalHeaders).catch(() => {});
    }
  } else {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', newEventId);
  }

  return res.json({ redriven: true, new_event_id: newEventId });
});

// ---------------------------------------------------------------------------
// GET /api/billing/status — tier + usage for the authenticated sink
// ---------------------------------------------------------------------------
router.get('/billing/status', requireAuth, (req, res) => {
  const sink = req.sink;
  const tier = sink.tier || 'free';
  const used = getMonthlyEventCount(db, sink.id);
  const limit = getEventLimit(tier);

  return res.json({
    sink_id: sink.id,
    tier,
    events_this_month: used,
    events_limit: limit,
    usage_pct: Math.min(100, Math.round((used / limit) * 100)),
  });
});

// ---------------------------------------------------------------------------
// POST /api/billing/checkout — create a Stripe Checkout session (Free → Starter)
// ---------------------------------------------------------------------------
router.post('/billing/checkout', requireAuth, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_STARTER_PRICE_ID;
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

  if (!stripeKey || !priceId) {
    return res.status(503).json({ error: 'Stripe not configured on this server' });
  }

  const stripe = require('stripe')(stripeKey);
  const sink = req.sink;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: sink.id,
      // Reuse existing customer if we already have one
      ...(sink.stripe_customer_id ? { customer: sink.stripe_customer_id } : {}),
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/checkout] Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
