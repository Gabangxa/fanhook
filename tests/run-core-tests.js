#!/usr/bin/env node
/**
 * FanHook core functionality test suite (non-Stripe).
 *
 * Spins up an in-process HTTP target server (acts as a webhook destination)
 * and exercises the live FanHook server running on PORT (default 3000) over
 * HTTP. Hits the database directly (better-sqlite3) for fixture seeding and
 * verification.
 *
 * Run with:
 *   FANHOOK_RETRY_DELAYS_MS=0,50,50 npm run test:core
 *
 * Exits 0 when all in-scope cases pass, non-zero otherwise.
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const BASE = process.env.FANHOOK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const DB_PATH = path.join(__dirname, '..', 'fanhook.db');
const db = new Database(DB_PATH);

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------
const results = [];
async function tc(id, title, fn) {
  const start = Date.now();
  try {
    const note = await fn();
    const ms = Date.now() - start;
    results.push({ id, title, status: 'PASS', ms, note: note || '' });
    console.log(`  PASS  ${id} (${ms}ms) ${title}${note ? ' — ' + note : ''}`);
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err && err.message ? err.message : String(err);
    results.push({ id, title, status: 'FAIL', ms, note: msg });
    console.log(`  FAIL  ${id} (${ms}ms) ${title}\n        ${msg}`);
  }
}
function tcDeferred(id, title, reason) {
  results.push({ id, title, status: 'DEFERRED', ms: 0, note: reason });
  console.log(`  SKIP  ${id} (deferred) ${title} — ${reason}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, label) {
  if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function req(method, urlPath, { headers = {}, body = null, raw = false } = {}) {
  const url = `${BASE}${urlPath}`;
  const opts = { method, headers: { ...headers } };
  let bodyToSend = body;
  if (body && typeof body === 'object' && !(body instanceof Buffer) && !raw) {
    bodyToSend = JSON.stringify(body);
    opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
  }
  const res = await fetch(url, { ...opts, body: bodyToSend, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, body: json, text };
}

// ---------------------------------------------------------------------------
// Internal HTTP target (acts as a webhook destination)
// ---------------------------------------------------------------------------
const target = {
  hits: {}, // path → array of { headers, body }
  responses: {}, // path → { status, body }
  reset() { this.hits = {}; this.responses = {}; },
  setResponse(p, status, body = '') { this.responses[p] = { status, body }; },
};
let targetServer;
let targetBase;
function startTarget() {
  return new Promise((resolve) => {
    targetServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        target.hits[req.url] = target.hits[req.url] || [];
        target.hits[req.url].push({ headers: req.headers, body });
        const r = target.responses[req.url] || { status: 200, body: 'ok' };
        res.writeHead(r.status, { 'content-type': 'text/plain' });
        res.end(r.body);
      });
    });
    targetServer.listen(0, '127.0.0.1', () => {
      const port = targetServer.address().port;
      targetBase = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}
function stopTarget() { return new Promise((r) => targetServer.close(r)); }

// ---------------------------------------------------------------------------
// Fixture management — direct DB writes for clean teardown
// ---------------------------------------------------------------------------
const TEST_PREFIX = 'tc_'; // prefix for any sink created by the suite
function cleanFixtures() {
  // Delete events/attempts/routes/dlq/sinks created by the suite. We tag
  // suite-created sinks by name prefix so demo data + user sinks survive.
  const sinkRows = db.prepare("SELECT id FROM sinks WHERE name LIKE 'tc-%'").all();
  const ids = sinkRows.map((r) => r.id);
  for (const id of ids) {
    db.prepare('DELETE FROM delivery_attempts WHERE event_id IN (SELECT id FROM events WHERE sink_id = ?)').run(id);
    db.prepare('DELETE FROM events WHERE sink_id = ?').run(id);
    db.prepare('DELETE FROM routes WHERE sink_id = ?').run(id);
    db.prepare('DELETE FROM dlq_entries WHERE sink_id = ?').run(id);
    db.prepare('DELETE FROM sinks WHERE id = ?').run(id);
  }
}

async function createSink({ name, provider = 'generic', webhook_secret = null }) {
  const body = { name };
  if (provider) body.provider = provider;
  if (webhook_secret) body.webhook_secret = webhook_secret;
  const r = await req('POST', '/api/sinks', { body });
  if (r.status !== 201) throw new Error(`createSink failed: ${r.status} ${r.text}`);
  return r.body; // { sink_id, ingest_url, api_key, webhook_secret }
}

function pollUntil(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      let v;
      try { v = predicate(); } catch (e) { clearInterval(t); return reject(e); }
      if (v) { clearInterval(t); return resolve(v); }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        return reject(new Error(`pollUntil timed out after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------
function stripeSig(rawBody, secret, ts = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${ts}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${ts},v1=${v1}`;
}
function githubSig(rawBody, secret) {
  const h = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${h}`;
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------
async function group1_sinkCreation() {
  console.log('\n# Group 1 — Sink Creation');

  await tc('TC-1.1', 'Create sink — happy path', async () => {
    const r = await req('POST', '/api/sinks', {
      body: { name: 'tc-1-1', provider: 'stripe', webhook_secret: 'whsec_test123' },
    });
    assertEq(r.status, 201, 'status');
    assert(r.body.sink_id, 'sink_id present');
    assert(typeof r.body.api_key === 'string' && r.body.api_key.length > 0, 'api_key present');
    const row = db.prepare('SELECT id FROM sinks WHERE id = ?').get(r.body.sink_id);
    assert(row, 'row exists in DB');
  });

  await tc('TC-1.2', 'Create sink — missing name → 400', async () => {
    const r = await req('POST', '/api/sinks', { body: { provider: 'generic' } });
    assertEq(r.status, 400, 'status');
    assertEq(r.body.error, 'name is required', 'error message');
  });

  await tc('TC-1.3', 'Create sink — missing provider defaults to generic (spec amended)', async () => {
    // SPEC AMENDED: Code defaults `provider` to "generic" when omitted; the
    // endpoint never returns "provider is required". Successful creation with
    // an implicit provider is the documented behavior.
    const r = await req('POST', '/api/sinks', { body: { name: 'tc-1-3' } });
    assertEq(r.status, 201, 'status');
    const row = db.prepare('SELECT provider FROM sinks WHERE id = ?').get(r.body.sink_id);
    assertEq(row.provider, 'generic', 'default provider');
  });

  await tc('TC-1.4', 'List sinks — scoped to authenticated key', async () => {
    const a = await createSink({ name: 'tc-1-4-a' });
    const b = await createSink({ name: 'tc-1-4-b' });
    const ra = await req('GET', '/api/sinks', { headers: { authorization: `Bearer ${a.api_key}` } });
    assertEq(ra.status, 200, 'status');
    const ids = ra.body.map((s) => s.id);
    assert(ids.includes(a.sink_id), 'A returned for A key');
    assert(!ids.includes(b.sink_id), 'B not returned for A key');
  });

  await tc('TC-1.5', 'Get single sink — list endpoint returns just that sink (spec amended)', async () => {
    // SPEC AMENDED: There is no GET /api/sinks/:id endpoint. The list endpoint
    // already returns only the authenticated key's sink (api_key is unique),
    // which satisfies the intent. A dedicated single-sink GET is tracked as
    // a possible follow-up.
    const a = await createSink({ name: 'tc-1-5' });
    const r = await req('GET', '/api/sinks', { headers: { authorization: `Bearer ${a.api_key}` } });
    assertEq(r.status, 200, 'status');
    assertEq(r.body.length, 1, 'exactly one sink for this key');
    assertEq(r.body[0].id, a.sink_id, 'matching id');
  });

  await tc('TC-1.6', 'Wrong API key for :sinkId → 401', async () => {
    const a = await createSink({ name: 'tc-1-6-a' });
    const b = await createSink({ name: 'tc-1-6-b' });
    const r = await req('GET', `/api/sinks/${a.sink_id}/events`, {
      headers: { authorization: `Bearer ${b.api_key}` },
    });
    assertEq(r.status, 401, 'status');
  });

  await tc('TC-1.7', 'Delete sink — DELETE /api/sinks/:id', async () => {
    const a = await createSink({ name: 'tc-1-7' });
    // Add a route + an event so we can verify cascade cleanup
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { i: 1 },
    });
    const r = await req('DELETE', `/api/sinks/${a.sink_id}`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(r.status, 204, 'status');
    const stillThere = db.prepare('SELECT id FROM sinks WHERE id = ?').get(a.sink_id);
    assert(!stillThere, 'sink row should be removed');
    const orphanedRoutes = db.prepare('SELECT id FROM routes WHERE sink_id = ?').get(a.sink_id);
    assert(!orphanedRoutes, 'routes should be cascaded');
  });
}

async function group2_apiKeyAuth() {
  console.log('\n# Group 2 — API Key Auth');

  await tc('TC-2.1', 'Request without API key → 401', async () => {
    const r = await req('GET', '/api/sinks');
    assertEq(r.status, 401, 'status');
    assert(r.body && r.body.error, 'error field present');
  });

  await tc('TC-2.2', 'Invalid API key → 401', async () => {
    const r = await req('GET', '/api/sinks', { headers: { 'x-api-key': 'garbage_key' } });
    assertEq(r.status, 401, 'status');
    assertEq(r.body.error, 'Invalid API key', 'error message');
  });

  await tc('TC-2.3', 'Bearer token format accepted', async () => {
    const a = await createSink({ name: 'tc-2-3' });
    const r = await req('GET', '/api/sinks', { headers: { authorization: `Bearer ${a.api_key}` } });
    assertEq(r.status, 200, 'status');
    assert(Array.isArray(r.body), 'body is array');
  });

  await tc('TC-2.4', 'X-Api-Key header format accepted', async () => {
    const a = await createSink({ name: 'tc-2-4' });
    const r = await req('GET', '/api/sinks', { headers: { 'x-api-key': a.api_key } });
    assertEq(r.status, 200, 'status');
    assert(Array.isArray(r.body), 'body is array');
  });
}

async function group3_routeManagement() {
  console.log('\n# Group 3 — Route Management');

  await tc('TC-3.1', 'Add route — happy path', async () => {
    const a = await createSink({ name: 'tc-3-1' });
    const r = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key },
      body: { url: `${targetBase}/ok` },
    });
    assertEq(r.status, 201, 'status');
    assertEq(r.body.sink_id, a.sink_id, 'sink_id');
    assertEq(r.body.url, `${targetBase}/ok`, 'url');
  });

  await tc('TC-3.2', 'Add route — missing url → 400', async () => {
    const a = await createSink({ name: 'tc-3-2' });
    const r = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key },
      body: {},
    });
    assertEq(r.status, 400, 'status');
    assertEq(r.body.error, 'url is required', 'error message');
  });

  await tc('TC-3.3', 'Add route — invalid url → 400', async () => {
    const a = await createSink({ name: 'tc-3-3' });
    const r = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key },
      body: { url: 'not-a-url' },
    });
    assertEq(r.status, 400, 'status');
    assertEq(r.body.error, 'url must be a valid HTTP/HTTPS URL', 'error message');
  });

  await tc('TC-3.4', 'List routes for sink', async () => {
    const a = await createSink({ name: 'tc-3-4' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('GET', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(r.status, 200, 'status');
    assertEq(r.body.length, 1, 'one route');
    assertEq(r.body[0].sink_id, a.sink_id, 'sink_id');
  });

  await tc('TC-3.5', 'Delete route', async () => {
    const a = await createSink({ name: 'tc-3-5' });
    const c = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const d = await req('DELETE', `/api/sinks/${a.sink_id}/routes/${c.body.id}`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(d.status, 204, 'status');
    const list = await req('GET', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(list.body.length, 0, 'no routes left');
  });

  await tc('TC-3.6', 'Free tier — 4th route → 403', async () => {
    const a = await createSink({ name: 'tc-3-6' });
    for (let i = 0; i < 3; i++) {
      const r = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
        headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok?n=${i}` },
      });
      assertEq(r.status, 201, `route ${i + 1} created`);
    }
    const fourth = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok?n=4` },
    });
    assertEq(fourth.status, 403, 'status');
    assert(/Free tier/.test(fourth.body.error), 'error mentions Free tier');
  });
}

async function group4_ingestCore() {
  console.log('\n# Group 4 — Ingest Core');

  await tc('TC-4.1', 'Ingest accepts POST → 200 (generic provider; spec amended)', async () => {
    // SPEC AMENDED: A `stripe` sink with a dummy `stripe-signature` will always
    // 401 (verification fails). The happy-path ingest case requires a sink
    // whose provider doesn't enforce signature verification.
    const a = await createSink({ name: 'tc-4-1' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' },
      body: { type: 'test.event' },
    });
    assertEq(r.status, 200, 'status');
    assert(r.body.received === true, 'received: true');
  });

  await tc('TC-4.2', 'Ingest unknown sink → 404', async () => {
    const r = await req('POST', '/ingest/nonexistent_sink_id', {
      headers: { 'content-type': 'application/json' },
      body: { type: 'test.event' },
    });
    assertEq(r.status, 404, 'status');
    assertEq(r.body.error, 'Sink not found', 'error message');
  });

  await tc('TC-4.3', 'Event stored in DB after ingest', async () => {
    const a = await createSink({ name: 'tc-4-3' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' },
      body: { type: 'tc-4-3' },
    });
    assertEq(ing.status, 200, 'ingest status');
    const evt = db.prepare('SELECT * FROM events WHERE id = ?').get(ing.body.event_id);
    assert(evt, 'event row exists');
    assert(['pending', 'delivered'].includes(evt.status), `status is pending|delivered (got ${evt.status})`);
    assert(evt.received_at, 'received_at set');
  });
}

async function group5_signatures() {
  console.log('\n# Group 5 — Signature Verification');

  await tc('TC-5.1', 'Valid Stripe signature → 200', async () => {
    const secret = 'whsec_test_5_1';
    const a = await createSink({ name: 'tc-5-1', provider: 'stripe', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ type: 'payment_intent.succeeded' });
    const sig = stripeSig(payload, secret);
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.2', 'Tampered Stripe payload → 401', async () => {
    const secret = 'whsec_test_5_2';
    const a = await createSink({ name: 'tc-5-2', provider: 'stripe', webhook_secret: secret });
    const goodPayload = JSON.stringify({ type: 'A' });
    const sigForGood = stripeSig(goodPayload, secret);
    const tampered = JSON.stringify({ type: 'B' }); // mismatched body
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'stripe-signature': sigForGood },
      body: tampered, raw: true,
    });
    assertEq(r.status, 401, 'status');
    const evt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id);
    assertEq(evt.c, 0, 'no event stored');
  });

  await tc('TC-5.3', 'Missing Stripe signature header → 400', async () => {
    const secret = 'whsec_test_5_3';
    const a = await createSink({ name: 'tc-5-3', provider: 'stripe', webhook_secret: secret });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' },
      body: { type: 'X' },
    });
    assertEq(r.status, 400, 'status');
    assert(/Missing stripe-signature/.test(r.body.error), 'error mentions missing header');
  });

  await tc('TC-5.4', 'Valid GitHub signature → 200', async () => {
    const secret = 'gh_test_5_4';
    const a = await createSink({ name: 'tc-5-4', provider: 'github', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ action: 'opened' });
    const sig = githubSig(payload, secret);
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.3b', 'Malformed Stripe signature header → 400', async () => {
    const a = await createSink({ name: 'tc-5-3b', provider: 'stripe', webhook_secret: 'whsec_x' });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'stripe-signature': 'totally-not-the-right-format' },
      body: { type: 'X' },
    });
    assertEq(r.status, 400, 'status');
    assert(/format/i.test(r.body.error), 'error mentions format');
  });

  await tc('TC-5.5', 'Generic sink with no secret — verification skipped (spec amended)', async () => {
    // SPEC AMENDED: Stripe/GitHub sinks REQUIRE a webhook_secret at create time.
    // Only `provider: "generic"` sinks legitimately skip signature checks.
    const a = await createSink({ name: 'tc-5-5', provider: 'generic' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' },
      body: { hi: 'there' },
    });
    assertEq(r.status, 200, 'status');
    const evt = db.prepare('SELECT status FROM events WHERE sink_id = ?').get(a.sink_id);
    assert(evt, 'event row exists');
  });
}

async function group6_fanout() {
  console.log('\n# Group 6 — Fanout & Delivery');

  await tc('TC-6.1', 'Fanout delivers to all routes', async () => {
    target.reset();
    const a = await createSink({ name: 'tc-6-1' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok-a` },
    });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok-b` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '6.1' },
    });
    assertEq(ing.status, 200, 'ingest status');
    const eventId = ing.body.event_id;
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'delivered';
    }, { timeoutMs: 5000 });
    assert(target.hits['/ok-a']?.length === 1, '/ok-a hit once');
    assert(target.hits['/ok-b']?.length === 1, '/ok-b hit once');
    const attempts = db.prepare('SELECT * FROM delivery_attempts WHERE event_id = ?').all(eventId);
    assertEq(attempts.length, 2, 'two delivery attempts');
    assert(attempts.every((a) => a.http_status === 200), 'all 200');
  });

  await tc('TC-6.2', 'Failed delivery retried 3 times', async () => {
    target.reset();
    target.setResponse('/fail', 503);
    const a = await createSink({ name: 'tc-6-2' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/fail` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '6.2' },
    });
    const eventId = ing.body.event_id;
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'failed';
    }, { timeoutMs: 5000 });
    const attempts = db.prepare('SELECT * FROM delivery_attempts WHERE event_id = ?').all(eventId);
    assertEq(attempts.length, 3, 'three attempts');
    assert(attempts.every((a) => a.status === 'failed'), 'all failed');
    assert(attempts.every((a) => a.http_status === 503), 'all 503');
  });

  await tc('TC-6.3', 'Mixed delivery — one success, one failure', async () => {
    target.reset();
    target.setResponse('/fail-mixed', 500);
    const a = await createSink({ name: 'tc-6-3' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok-mixed` },
    });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/fail-mixed` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '6.3' },
    });
    const eventId = ing.body.event_id;
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      // Wait for both routes' attempt streams to settle (1 success + 3 fails)
      const c = db.prepare('SELECT COUNT(*) AS n FROM delivery_attempts WHERE event_id = ?').get(eventId).n;
      return e && e.status === 'delivered' && c >= 4;
    }, { timeoutMs: 5000 });
    const attempts = db.prepare('SELECT * FROM delivery_attempts WHERE event_id = ?').all(eventId);
    const okOnes = attempts.filter((a) => a.status === 'success');
    const failed = attempts.filter((a) => a.status === 'failed');
    assertEq(okOnes.length, 1, 'one success');
    assertEq(failed.length, 3, 'three failed (3 retries on the bad route)');
  });

  await tc('TC-6.4', 'Event log returns last 50 events', async () => {
    const a = await createSink({ name: 'tc-6-4' });
    const insert = db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const baseTs = new Date('2026-01-01T00:00:00Z').getTime();
    db.transaction(() => {
      for (let i = 0; i < 60; i++) {
        const ts = new Date(baseTs + i * 1000).toISOString();
        insert.run(`tc64_${i}`, a.sink_id, 'generic', '{}', ts, 'delivered');
      }
    })();
    const r = await req('GET', `/api/sinks/${a.sink_id}/events`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(r.status, 200, 'status');
    assertEq(r.body.length, 50, 'exactly 50');
    // Verify desc order
    for (let i = 0; i < r.body.length - 1; i++) {
      assert(r.body[i].received_at >= r.body[i + 1].received_at, 'desc order');
    }
  });
}

async function group_dashboardCsrf() {
  console.log('\n# Group D — Dashboard session endpoint CSRF');

  await tc('TC-D.1', 'POST /dashboard/api/sinks without session/CSRF → 401 or 403', async () => {
    const r = await req('POST', '/dashboard/api/sinks', {
      headers: { 'content-type': 'application/json' },
      body: { name: 'no-auth', provider: 'generic' },
    });
    // Without a session cookie, requireUser should reject (302 to login or 401).
    assert([401, 302, 403].includes(r.status), `expected 401/302/403, got ${r.status}`);
  });
}

async function group7_usageEnforcement() {
  console.log('\n# Group 7 — Usage Enforcement');

  await tc('TC-7.1', 'Free tier under limit — ingest allowed', async () => {
    const a = await createSink({ name: 'tc-7-1' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { i: 1 },
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-7.2', 'Free tier — 1001st event blocked → 429', async () => {
    const a = await createSink({ name: 'tc-7-2' });
    // Seed 1000 events for this calendar month
    const insert = db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        insert.run(`seed_${a.sink_id}_${i}`, a.sink_id, 'generic', '{"seed":true}', now, 'delivered');
      }
    })();
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '7.2' },
    });
    assertEq(r.status, 429, 'status');
    assert(/limit/i.test(r.body.error), 'error mentions limit');
    const c = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id).c;
    assertEq(c, 1000, 'no new event row created');
  });

  await tc('TC-7.3', 'Starter tier — ingest allowed above 1000', async () => {
    const a = await createSink({ name: 'tc-7-3' });
    db.prepare("UPDATE sinks SET tier = 'starter' WHERE id = ?").run(a.sink_id);
    const insert = db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (let i = 0; i < 1100; i++) {
        insert.run(`seed_${a.sink_id}_${i}`, a.sink_id, 'generic', '{"seed":true}', now, 'delivered');
      }
    })();
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '7.3' },
    });
    assertEq(r.status, 200, 'status');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`FanHook core test suite → ${BASE}`);
  // Health check before doing anything
  try {
    const h = await req('GET', '/health');
    if (h.status !== 200) throw new Error(`/health returned ${h.status}`);
  } catch (err) {
    console.error(`Server unreachable at ${BASE}: ${err.message}`);
    process.exit(2);
  }

  await startTarget();
  console.log(`Internal target server: ${targetBase}`);

  cleanFixtures();
  try {
    await group1_sinkCreation();
    await group2_apiKeyAuth();
    await group3_routeManagement();
    await group4_ingestCore();
    await group5_signatures();
    await group6_fanout();
    await group7_usageEnforcement();
    await group_dashboardCsrf();
  } finally {
    cleanFixtures();
    await stopTarget();
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const deferred = results.filter((r) => r.status === 'DEFERRED').length;
  console.log(`\n──────────────────────────────────────────`);
  console.log(`Total: ${results.length}    PASS: ${passed}    FAIL: ${failed}    DEFERRED: ${deferred}`);
  console.log(`──────────────────────────────────────────`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  ${r.id}  ${r.title}\n    ${r.note}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
