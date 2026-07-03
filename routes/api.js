const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getMonthlyEventCount, getEventLimit, incrementMonthlyUsage } = require('../lib/metering');
const natsLib = require('../lib/nats');
const outbox = require('../lib/outbox');
const auth = require('../lib/auth');
const { hashApiKey, findSinkByApiKey } = require('../lib/apikeys');
const ssrf = require('../lib/ssrf');

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth middleware — validates the API key (stored hashed; the presented
// plaintext token is hashed and compared) and attaches req.sink.
//
// Session fallback: the dashboard authenticates with its session cookie
// instead of an API key (plaintext keys are shown only once at creation, so
// the dashboard can no longer embed one). Mutating requests via session auth
// additionally require the CSRF token (double-submit cookie).
// ---------------------------------------------------------------------------
function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const xApiKey = req.headers['x-api-key'] || '';
  return authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (xApiKey ? String(xApiKey).trim() : null);
}

function sessionCsrfOk(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return auth.verifyCsrf(req);
}

function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    const sink = findSinkByApiKey(db, token);
    if (!sink) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.sink = sink;
    return next();
  }

  // Session-cookie fallback (dashboard): use the user's primary sink.
  const user = auth.getSessionUser(req);
  if (user) {
    if (!sessionCsrfOk(req)) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
    const sink = db.prepare(
      'SELECT * FROM sinks WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
    ).get(user.id);
    if (sink) {
      req.sink = sink;
      req.user = user;
      return next();
    }
  }

  return res.status(401).json({ error: 'Missing API key (use Authorization: Bearer <key> or X-Api-Key header)' });
}

// For routes that also take :sinkId — verify the sink belongs to the bearer
// (API key) or to the signed-in user (session cookie).
function requireSinkAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    const sink = findSinkByApiKey(db, token);
    if (!sink) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (sink.id !== req.params.sinkId) {
      return res.status(401).json({ error: 'Invalid API key for this sink' });
    }
    req.sink = sink;
    return next();
  }

  const user = auth.getSessionUser(req);
  if (user) {
    if (!sessionCsrfOk(req)) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
    const sink = db.prepare('SELECT * FROM sinks WHERE id = ?').get(req.params.sinkId);
    if (sink && sink.user_id === user.id) {
      req.sink = sink;
      req.user = user;
      return next();
    }
    return res.status(401).json({ error: 'Sink not found or not owned by this account' });
  }

  return res.status(401).json({ error: 'Missing API key (use Authorization: Bearer <key> or X-Api-Key header)' });
}

// ---------------------------------------------------------------------------
// POST /api/sinks — create a new sink (no auth required — self-service registration)
// ---------------------------------------------------------------------------
router.post('/sinks', (req, res) => {
  const { name, provider = 'generic', webhook_secret } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const VALID_PROVIDERS = ['stripe', 'github', 'shopify', 'linear', 'pagerduty', 'clerk', 'generic'];
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }

  const SECRET_REQUIRED = new Set(['stripe', 'github', 'shopify', 'linear', 'pagerduty', 'clerk']);
  if (SECRET_REQUIRED.has(provider) && !webhook_secret) {
    return res.status(400).json({ error: `webhook_secret is required for provider '${provider}'` });
  }

  const sinkId = uuidv4();
  const apiKey = uuidv4();
  const createdAt = new Date().toISOString();

  // Only the SHA-256 hash is persisted; the plaintext key is returned exactly
  // once in this response and cannot be recovered later.
  db.prepare(`
    INSERT INTO sinks (id, name, provider, api_key, webhook_secret, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sinkId, name, provider, hashApiKey(apiKey), webhook_secret || null, createdAt);

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
router.post('/sinks/:sinkId/routes', requireSinkAuth, async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'url must be a valid HTTP/HTTPS URL' });
  }

  // SSRF guard: resolve the destination and reject private/loopback/link-local/
  // metadata addresses. Re-checked again at delivery time (lib/fanout.js) to
  // defeat DNS rebinding.
  try {
    await ssrf.assertPublicDestination(url);
  } catch (err) {
    return res.status(400).json({ error: `Destination not allowed: ${err.message}` });
  }

  // Enforce per-tier route cap (Free: 3, Starter: 10).
  const { TIER_LIMITS } = require('../lib/metering');
  const tier = req.sink.tier || 'free';
  const routeCap = (TIER_LIMITS[tier] ?? TIER_LIMITS.free).routes;
  const existingCount = db
    .prepare('SELECT COUNT(*) AS c FROM routes WHERE sink_id = ?')
    .get(req.params.sinkId).c;
  if (existingCount >= routeCap) {
    return res.status(403).json({
      error: `${tier === 'free' ? 'Free' : 'Starter'} tier limited to ${routeCap} routes per sink`,
      tier,
      route_limit: routeCap,
      upgrade_url: '/dashboard#upgrade',
    });
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
// DELETE /api/sinks/:sinkId — remove a sink and all its dependent rows
// ---------------------------------------------------------------------------
router.delete('/sinks/:sinkId', requireSinkAuth, (req, res) => {
  const { sinkId } = req.params;
  db.transaction(() => {
    db.prepare(
      'DELETE FROM delivery_attempts WHERE event_id IN (SELECT id FROM events WHERE sink_id = ?)'
    ).run(sinkId);
    db.prepare('DELETE FROM events WHERE sink_id = ?').run(sinkId);
    db.prepare('DELETE FROM routes WHERE sink_id = ?').run(sinkId);
    db.prepare('DELETE FROM dlq_entries WHERE sink_id = ?').run(sinkId);
    db.prepare('DELETE FROM outbox WHERE sink_id = ?').run(sinkId);
    db.prepare('DELETE FROM monthly_usage WHERE sink_id = ?').run(sinkId);
    db.prepare('DELETE FROM sinks WHERE id = ?').run(sinkId);
  })();
  return res.status(204).send();
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
// GET /api/sinks/:sinkId/dlq — list last 50 DLQ entries for a sink
//
// Primary: uses JetStream OrderedConsumer to read from webhook.dlq.<sinkId>.
// Always merges in SQLite-only entries (nats_seq IS NULL) so that events whose
// NATS publish failed at failure-time still appear in the list.
// Full SQLite fallback when NATS is unavailable.
// ---------------------------------------------------------------------------
router.get('/sinks/:sinkId/dlq', requireSinkAuth, async (req, res) => {
  const { sinkId } = req.params;

  // SQLite-only entries: DLQ rows where publishToDLQ failed (nats_seq IS NULL).
  // These never made it to NATS so they won't appear in the JetStream results.
  const sqliteOnlyEntries = db
    .prepare(
      `SELECT event_id, sink_id, provider, failed_at, attempt_count, failure_reason,
              headers, nats_seq
       FROM dlq_entries
       WHERE sink_id = ? AND redriven = 0 AND nats_seq IS NULL
       ORDER BY failed_at DESC LIMIT 50`
    )
    .all(sinkId);

  // Try NATS JetStream OrderedConsumer (authoritative for entries that were published)
  let natsEntries = null;
  try {
    natsEntries = await natsLib.listDLQMessages(sinkId, 50);
  } catch (_) {
    // NATS unavailable — full SQLite fallback below
  }

  if (natsEntries === null) {
    // Full SQLite fallback when NATS is down
    const allSqlite = db
      .prepare(
        `SELECT event_id, sink_id, provider, failed_at, attempt_count, failure_reason,
                headers, nats_seq
         FROM dlq_entries
         WHERE sink_id = ? AND redriven = 0
         ORDER BY failed_at DESC LIMIT 50`
      )
      .all(sinkId);
    return res.json(allSqlite);
  }

  // NATS is available — merge NATS results with SQLite-only entries.
  // Deduplicate by event_id (NATS result takes precedence as it has _nats_seq),
  // then sort newest-first and cap at 50.
  const natsEventIds = new Set(natsEntries.map(e => e.event_id));
  const merged = [
    ...natsEntries,
    ...sqliteOnlyEntries.filter(e => !natsEventIds.has(e.event_id)),
  ];
  merged.sort((a, b) => (a.failed_at < b.failed_at ? 1 : -1));
  return res.json(merged.slice(0, 50));
});

// ---------------------------------------------------------------------------
// POST /api/sinks/:sinkId/dlq/:eventId/redrive — redrive a DLQ entry
//
// 1. Looks up the entry in SQLite (always available) to get raw body + nats_seq
// 2. Creates a fresh event record
// 3. Dispatches delivery via NATS (preferred) or direct fanout (fallback)
// 4. Only after confirmed dispatch: marks dlq_entries as redriven and deletes
//    the DLQ message from the NATS JetStream stream (if nats_seq is known)
//    The entry is left intact if dispatch fails so it can be redriven again.
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

  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);
  if (routes.length === 0) {
    return res.status(422).json({ error: 'No routes configured for this sink; cannot redrive' });
  }

  const newEventId = uuidv4();
  const receivedAt = new Date().toISOString();
  const rawBody = Buffer.from(entry.raw_body_b64 || '', 'base64');
  let originalHeaders = {};
  try { originalHeaders = JSON.parse(entry.headers || '{}'); } catch (_) {}
  const payload = rawBody.toString('utf8') || '{}';

  // Create a fresh event record so the redriven delivery appears in the event
  // log. Counter bumped in the same transaction — every event-insert path must
  // keep monthly_usage in sync.
  db.transaction(() => {
    db.prepare(`
      INSERT INTO events (id, sink_id, provider, payload, received_at, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newEventId, sinkId, entry.provider || sink.provider, payload, receivedAt, 'pending');
    incrementMonthlyUsage(db, sinkId);
  })();

  // Dispatch the redriven event via NATS (preferred) or direct fanout (fallback).
  // We only commit the DLQ entry as redriven after dispatch is confirmed so that
  // a failure leaves the entry intact and eligible for another redrive attempt.
  let dispatchOk = false;
  try {
    await natsLib.publish(sinkId, {
      eventId: newEventId,
      sinkId,
      rawBodyB64: entry.raw_body_b64 || '',
      headers: originalHeaders,
    });
    dispatchOk = true;
  } catch (_) {
    // NATS unavailable — enqueue durably in the outbox; the sweeper delivers it
    outbox.enqueue(db, {
      eventId: newEventId,
      sinkId,
      rawBodyB64: entry.raw_body_b64 || '',
      headers: originalHeaders,
    });
    outbox.notify();
    dispatchOk = true; // durably enqueued; treat as confirmed
  }

  if (!dispatchOk) {
    // Both dispatch paths failed — keep DLQ entry intact, clean up the event row
    db.prepare('DELETE FROM events WHERE id = ?').run(newEventId);
    return res.status(502).json({ error: 'Dispatch failed; DLQ entry unchanged, retry redrive' });
  }

  // Dispatch confirmed — now commit the redriven state
  db.prepare(
    'UPDATE dlq_entries SET redriven = 1, redriven_at = ?, new_event_id = ? WHERE event_id = ?'
  ).run(receivedAt, newEventId, eventId);

  // Delete the original DLQ message from the JetStream stream. Non-fatal if it
  // fails — the 7-day TTL will expire it naturally.
  if (entry.nats_seq) {
    try {
      await natsLib.deleteDLQMessage(entry.nats_seq);
    } catch (_) {
      // Non-fatal: message will expire via the 7-day stream TTL
    }
  }

  return res.json({ redriven: true, new_event_id: newEventId });
});

// ---------------------------------------------------------------------------
// GET /api/sinks/:sinkId/stream — SSE endpoint for live event status updates
//
// Auth: session cookie (dashboard EventSource — browsers send cookies with
// same-origin EventSource requests) or an API key header (Authorization:
// Bearer / X-Api-Key) for programmatic consumers. Query-string keys (?key=)
// are explicitly rejected: they leak into server logs, proxy logs, and
// browser history.
//
// Subscribes to events.status.<sinkId> on NATS core and forwards each message
// as a `data:` SSE frame. Sends `: ping` keepalives every 25 seconds.
// If NATS is unavailable the stream stays open and retries on a backoff
// schedule — once NATS comes back, live updates flow without a page refresh.
// Cleans up the NATS subscription and interval on HTTP close.
// ---------------------------------------------------------------------------
router.get('/sinks/:sinkId/stream', async (req, res) => {
  const { sinkId } = req.params;

  if (req.query.key !== undefined) {
    return res.status(401).json({
      error: 'API key in query string is not allowed. Use an Authorization: Bearer or X-Api-Key header, or a signed-in session.',
    });
  }

  const token = extractToken(req);
  let sink = null;
  if (token) {
    const found = findSinkByApiKey(db, token);
    if (!found) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    if (found.id !== sinkId) {
      return res.status(401).json({ error: 'Invalid API key for this sink' });
    }
    sink = found;
  } else {
    const user = auth.getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required (API key header or session)' });
    }
    const found = db.prepare('SELECT * FROM sinks WHERE id = ?').get(sinkId);
    if (!found || found.user_id !== user.id) {
      return res.status(401).json({ error: 'Sink not found or not owned by this account' });
    }
    sink = found;
  }

  // Commit SSE headers immediately — the stream stays open even while NATS is
  // unavailable. Keepalive pings prevent proxy idle-timeouts during the wait.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  let sub = null;
  let retryTimer = null;

  // Keepalive ping every 25 seconds to survive proxy idle timeouts
  const pingInterval = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 25_000);

  // Cleanup when the browser disconnects
  res.on('close', () => {
    closed = true;
    clearInterval(pingInterval);
    clearTimeout(retryTimer);
    if (sub) {
      try { sub.unsubscribe(); } catch (_) {}
    }
  });

  // Exponential backoff delays (ms): 0, 1 s, 2 s, 4 s, 8 s, 16 s, 30 s, 30 s, …
  const BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000, 30000];
  let attempt = 0;

  async function tryConnect() {
    if (closed) return;

    try {
      const nc = await natsLib.getConnection();
      sub = nc.subscribe(`events.status.${sinkId}`);
      attempt = 0; // reset backoff counter on successful connect

      // Forward each NATS message as an SSE data frame
      try {
        for await (const msg of sub) {
          if (closed) break;
          const data = natsLib.jc.decode(msg.data);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (_) {
        // Subscription iterator closed (NATS disconnected or unsubscribed)
      }

      // If we reach here and the client is still connected, NATS went away —
      // reset and schedule a reconnect attempt.
      if (!closed) {
        sub = null;
        scheduleRetry();
      }
    } catch (_) {
      // getConnection() failed — NATS is unavailable; retry with backoff
      if (!closed) {
        scheduleRetry();
      }
    }
  }

  function scheduleRetry() {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    retryTimer = setTimeout(tryConnect, delay);
  }

  scheduleRetry();
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
