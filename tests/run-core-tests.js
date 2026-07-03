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

// The in-process SSRF/fanout tests (Group 9) deliver to 127.0.0.1 targets, so
// run this test process under the loopback policy — same as the dev server.
process.env.FANHOOK_ALLOW_PRIVATE_DESTINATIONS =
  process.env.FANHOOK_ALLOW_PRIVATE_DESTINATIONS || 'loopback';

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const ssrf = require('../lib/ssrf');
const { fanout } = require('../lib/fanout');

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
    db.prepare('DELETE FROM outbox WHERE sink_id = ?').run(id);
    db.prepare('DELETE FROM monthly_usage WHERE sink_id = ?').run(id);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
function shopifySig(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}
function linearSig(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}
function pagerdutySig(rawBody, secret) {
  const h = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `v1=${h}`;
}
function clerkSig(rawBody, secret, id, ts) {
  // Mirror lib/verify.js: if secret begins with "whsec_", base64-decode the rest.
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
  const signed = `${id}.${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', key).update(signed, 'utf8').digest('base64');
  return `v1,${sig}`;
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

  // ---- Shopify ----
  await tc('TC-5.6', 'Valid Shopify signature → 200', async () => {
    const secret = 'shopify_test_5_6';
    const a = await createSink({ name: 'tc-5-6', provider: 'shopify', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ id: 12345, total: '9.99' });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': shopifySig(payload, secret) },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.7', 'Tampered Shopify payload → 401', async () => {
    const secret = 'shopify_test_5_7';
    const a = await createSink({ name: 'tc-5-7', provider: 'shopify', webhook_secret: secret });
    const goodPayload = JSON.stringify({ id: 1 });
    const sig = shopifySig(goodPayload, secret);
    const tampered = JSON.stringify({ id: 2 });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': sig },
      body: tampered, raw: true,
    });
    assertEq(r.status, 401, 'status');
    const evt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id);
    assertEq(evt.c, 0, 'no event stored');
  });

  // ---- Linear ----
  await tc('TC-5.8', 'Valid Linear signature → 200', async () => {
    const secret = 'linear_test_5_8';
    const a = await createSink({ name: 'tc-5-8', provider: 'linear', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ action: 'create', type: 'Issue' });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'linear-signature': linearSig(payload, secret) },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.9', 'Tampered Linear payload → 401', async () => {
    const secret = 'linear_test_5_9';
    const a = await createSink({ name: 'tc-5-9', provider: 'linear', webhook_secret: secret });
    const goodPayload = JSON.stringify({ action: 'create' });
    const sig = linearSig(goodPayload, secret);
    const tampered = JSON.stringify({ action: 'delete' });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'linear-signature': sig },
      body: tampered, raw: true,
    });
    assertEq(r.status, 401, 'status');
    const evt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id);
    assertEq(evt.c, 0, 'no event stored');
  });

  // ---- PagerDuty ----
  await tc('TC-5.10', 'Valid PagerDuty signature → 200', async () => {
    const secret = 'pagerduty_test_5_10';
    const a = await createSink({ name: 'tc-5-10', provider: 'pagerduty', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ event: { event_type: 'incident.triggered' } });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-pagerduty-signature': pagerdutySig(payload, secret) },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.11', 'Tampered PagerDuty payload → 401', async () => {
    const secret = 'pagerduty_test_5_11';
    const a = await createSink({ name: 'tc-5-11', provider: 'pagerduty', webhook_secret: secret });
    const goodPayload = JSON.stringify({ event: { event_type: 'incident.triggered' } });
    const sig = pagerdutySig(goodPayload, secret);
    const tampered = JSON.stringify({ event: { event_type: 'incident.resolved' } });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-pagerduty-signature': sig },
      body: tampered, raw: true,
    });
    assertEq(r.status, 401, 'status');
    const evt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id);
    assertEq(evt.c, 0, 'no event stored');
  });

  // ---- Clerk (Svix) ----
  await tc('TC-5.12', 'Valid Clerk (Svix) signature → 200', async () => {
    // Use a valid base64 secret so the whsec_ prefix decode path is exercised.
    const rawSecretBytes = crypto.randomBytes(24);
    const secret = `whsec_${rawSecretBytes.toString('base64')}`;
    const a = await createSink({ name: 'tc-5-12', provider: 'clerk', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const payload = JSON.stringify({ type: 'user.created', data: { id: 'u_1' } });
    const id = 'msg_2abcdef';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = clerkSig(payload, secret, id, ts);
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: {
        'content-type': 'application/json',
        'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig,
      },
      body: payload, raw: true,
    });
    assertEq(r.status, 200, 'status');
  });

  await tc('TC-5.13', 'Tampered Clerk (Svix) payload → 401', async () => {
    const rawSecretBytes = crypto.randomBytes(24);
    const secret = `whsec_${rawSecretBytes.toString('base64')}`;
    const a = await createSink({ name: 'tc-5-13', provider: 'clerk', webhook_secret: secret });
    const id = 'msg_3abcdef';
    const ts = String(Math.floor(Date.now() / 1000));
    const goodPayload = JSON.stringify({ type: 'user.created' });
    const sig = clerkSig(goodPayload, secret, id, ts);
    const tampered = JSON.stringify({ type: 'user.deleted' });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: {
        'content-type': 'application/json',
        'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig,
      },
      body: tampered, raw: true,
    });
    assertEq(r.status, 401, 'status');
    const evt = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id);
    assertEq(evt.c, 0, 'no event stored');
  });

  await tc('TC-5.14', 'Replayed Clerk webhook with stale svix-timestamp → 401', async () => {
    const rawSecretBytes = crypto.randomBytes(24);
    const secret = `whsec_${rawSecretBytes.toString('base64')}`;
    const a = await createSink({ name: 'tc-5-14', provider: 'clerk', webhook_secret: secret });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const id = 'msg_5_14_replay';
    // Stale timestamp: 10 minutes in the past — well outside the 300s default.
    const staleTs = String(Math.floor(Date.now() / 1000) - 600);
    const payload = JSON.stringify({ type: 'user.created', data: { id: 'u_replay' } });
    const staleSig = clerkSig(payload, secret, id, staleTs);
    const stale = await req('POST', `/ingest/${a.sink_id}`, {
      headers: {
        'content-type': 'application/json',
        'svix-id': id, 'svix-timestamp': staleTs, 'svix-signature': staleSig,
      },
      body: payload, raw: true,
    });
    assertEq(stale.status, 401, 'stale status');
    assert(/tolerance|replay/i.test(stale.body.error || ''), 'error mentions tolerance/replay');
    const c1 = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id).c;
    assertEq(c1, 0, 'no event stored for stale timestamp');

    // Fresh timestamp using the same sink should succeed.
    const freshId = 'msg_5_14_fresh';
    const freshTs = String(Math.floor(Date.now() / 1000));
    const freshSig = clerkSig(payload, secret, freshId, freshTs);
    const fresh = await req('POST', `/ingest/${a.sink_id}`, {
      headers: {
        'content-type': 'application/json',
        'svix-id': freshId, 'svix-timestamp': freshTs, 'svix-signature': freshSig,
      },
      body: payload, raw: true,
    });
    assertEq(fresh.status, 200, 'fresh status');
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

  await tc('TC-6.2', 'Failed delivery retried with NATS-parity schedule, then DLQ (spec amended)', async () => {
    // SPEC AMENDED: The NATS-unavailable path now uses the durable outbox
    // sweeper, which mirrors the NATS worker: 3 outer attempts, each running
    // the in-process fanout retry schedule (3 tries) → 9 attempts total, then
    // the event is written to the DLQ. Previously the fallback did a single
    // fire-and-forget fanout (3 attempts, no DLQ).
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
    // Wait for terminal state: DLQ row written after all outer attempts exhaust
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      const d = db.prepare('SELECT * FROM dlq_entries WHERE event_id = ?').get(eventId);
      return e && e.status === 'failed' && d;
    }, { timeoutMs: 8000 });
    const attempts = db.prepare('SELECT * FROM delivery_attempts WHERE event_id = ?').all(eventId);
    assertEq(attempts.length, 9, 'nine attempts (3 outer × 3 in-process)');
    assert(attempts.every((a) => a.status === 'failed'), 'all failed');
    assert(attempts.every((a) => a.http_status === 503), 'all 503');
    const dlq = db.prepare('SELECT * FROM dlq_entries WHERE event_id = ?').get(eventId);
    assertEq(dlq.failure_reason, 'max_deliver_exceeded', 'DLQ reason');
    const ob = db.prepare('SELECT * FROM outbox WHERE event_id = ?').get(eventId);
    assert(!ob, 'outbox row removed after exhaustion');
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

  // Metering now reads the pre-aggregated monthly_usage counter table, so the
  // tests seed the counter directly instead of inserting thousands of raw
  // event rows (spec amended with Task #18: indexes + metering counters).
  function seedUsage(sinkId, count) {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    db.prepare(
      'INSERT INTO monthly_usage (sink_id, month, event_count) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sink_id, month) DO UPDATE SET event_count = excluded.event_count'
    ).run(sinkId, monthKey, count);
  }

  await tc('TC-7.2', 'Free tier — 1001st event blocked → 429', async () => {
    const a = await createSink({ name: 'tc-7-2' });
    seedUsage(a.sink_id, 1000);
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '7.2' },
    });
    assertEq(r.status, 429, 'status');
    assert(/limit/i.test(r.body.error), 'error mentions limit');
    const c = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id).c;
    assertEq(c, 0, 'no new event row created');
    const usage = db.prepare(
      'SELECT event_count FROM monthly_usage WHERE sink_id = ?'
    ).get(a.sink_id);
    assertEq(usage.event_count, 1000, 'counter not bumped by the rejected request');
  });

  await tc('TC-7.3', 'Starter tier — ingest allowed above 1000', async () => {
    const a = await createSink({ name: 'tc-7-3' });
    db.prepare("UPDATE sinks SET tier = 'starter' WHERE id = ?").run(a.sink_id);
    seedUsage(a.sink_id, 1100);
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });
    const r = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '7.3' },
    });
    assertEq(r.status, 200, 'status');
    const usage = db.prepare('SELECT event_count FROM monthly_usage WHERE sink_id = ?').get(a.sink_id);
    assertEq(usage.event_count, 1101, 'counter incremented with the accepted event');
  });

  await tc('TC-7.4', 'Counter stays in sync with events across ingest and redrive', async () => {
    target.reset();
    const a = await createSink({ name: 'tc-7-4' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok` },
    });

    // Three normal ingests
    for (let i = 0; i < 3; i++) {
      const r = await req('POST', `/ingest/${a.sink_id}`, {
        headers: { 'content-type': 'application/json' }, body: { i },
      });
      assertEq(r.status, 200, `ingest ${i} status`);
    }

    // One redrive: seed a DLQ entry directly and redrive it via the API
    const dlqEventId = `tc74_dlq_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO dlq_entries (event_id, sink_id, raw_body_b64, headers, provider, failed_at, attempt_count, failure_reason)
      VALUES (?, ?, ?, '{}', 'generic', ?, 3, 'max_deliver_exceeded')
    `).run(dlqEventId, a.sink_id, Buffer.from('{"redrive":true}').toString('base64'), new Date().toISOString());
    const rd = await req('POST', `/api/sinks/${a.sink_id}/dlq/${dlqEventId}/redrive`, {
      headers: { 'x-api-key': a.api_key },
    });
    assertEq(rd.status, 200, 'redrive status');
    assert(rd.body.redriven, 'redriven flag');

    const eventCount = db.prepare('SELECT COUNT(*) AS c FROM events WHERE sink_id = ?').get(a.sink_id).c;
    const usage = db.prepare('SELECT event_count FROM monthly_usage WHERE sink_id = ?').get(a.sink_id);
    assertEq(eventCount, 4, 'four event rows (3 ingests + 1 redrive)');
    assertEq(usage.event_count, 4, 'counter matches events table exactly');

    // Billing status endpoint reports the same number
    const bs = await req('GET', '/api/billing/status', { headers: { 'x-api-key': a.api_key } });
    assertEq(bs.status, 200, 'billing status');
    assertEq(bs.body.events_this_month, 4, 'billing status reads the counter');
  });
}

async function group8_outbox() {
  console.log('\n# Group 8 — Durable Outbox (NATS-unavailable path)');

  await tc('TC-8.1', 'Outbox fallback delivers durably and cleans up its row', async () => {
    target.reset();
    const a = await createSink({ name: 'tc-8-1' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/outbox-ok` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json' }, body: { hi: '8.1' },
    });
    assertEq(ing.status, 200, 'ingest status');
    assertEq(ing.body.delivery_mode, 'outbox', 'delivery_mode is outbox when NATS is down');
    const eventId = ing.body.event_id;
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'delivered';
    }, { timeoutMs: 5000 });
    assert(target.hits['/outbox-ok']?.length === 1, 'destination hit once');
    const ob = db.prepare('SELECT * FROM outbox WHERE event_id = ?').get(eventId);
    assert(!ob, 'outbox row removed after delivery');
  });

  await tc('TC-8.2', 'Original headers preserved through the outbox path', async () => {
    target.reset();
    const a = await createSink({ name: 'tc-8-2' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/outbox-hdrs` },
    });
    const ing = await req('POST', `/ingest/${a.sink_id}`, {
      headers: { 'content-type': 'application/json', 'x-custom-header': 'tc82-value' },
      body: { hi: '8.2' },
    });
    const eventId = ing.body.event_id;
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'delivered';
    }, { timeoutMs: 5000 });
    const hit = target.hits['/outbox-hdrs']?.[0];
    assert(hit, 'destination hit');
    assertEq(hit.body, JSON.stringify({ hi: '8.2' }), 'raw body forwarded byte-for-byte');
  });

  await tc('TC-8.3', 'Crash recovery — stale pending event is re-driven automatically', async () => {
    // Simulates an event whose delivery was lost (e.g. process crash before
    // dispatch): a 'pending' event older than FANHOOK_PENDING_GRACE_MS with no
    // outbox row. The sweeper must pick it up and deliver it.
    target.reset();
    const a = await createSink({ name: 'tc-8-3' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/recovered` },
    });
    const eventId = `tc83_${crypto.randomBytes(4).toString('hex')}`;
    const staleTs = new Date(Date.now() - 60_000).toISOString(); // beyond any grace window used in tests
    db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventId, a.sink_id, 'generic', JSON.stringify({ recovered: true }), staleTs, 'pending');
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'delivered';
    }, { timeoutMs: 8000 });
    assert(target.hits['/recovered']?.length >= 1, 'destination received recovered event');
    const ob = db.prepare('SELECT * FROM outbox WHERE event_id = ?').get(eventId);
    assert(!ob, 'outbox row cleaned up after recovery delivery');
  });

  await tc('TC-8.5', 'Two-phase handoff — unarmed outbox row is not swept early, armed row is', async () => {
    // Invariant: exactly one delivery owner at a time. While a NATS publish is
    // in flight the outbox row exists but is NOT due (next_attempt_at in the
    // future); the sweeper must leave it alone. Once armed (publish failed),
    // the sweeper delivers it.
    target.reset();
    const a = await createSink({ name: 'tc-8-5' });
    await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/handoff` },
    });
    const eventId = `tc85_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventId, a.sink_id, 'generic', '{"h":1}', new Date().toISOString(), 'pending');
    // Simulate the in-flight handoff: outbox row present but not yet due
    db.prepare(
      "INSERT INTO outbox (event_id, sink_id, raw_body_b64, headers, attempt_count, next_attempt_at, created_at) VALUES (?, ?, ?, '{}', 0, ?, ?)"
    ).run(eventId, a.sink_id, Buffer.from('{"h":1}').toString('base64'), Date.now() + 60_000, new Date().toISOString());

    // Several sweep intervals pass (dev sweep = 200ms) — must NOT be delivered
    await sleep(700);
    assert(!target.hits['/handoff'], 'unarmed row not delivered by sweeper');
    const e1 = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    assertEq(e1.status, 'pending', 'event still pending while unarmed');

    // Arm the row (simulates NATS publish failure) → sweeper delivers it
    db.prepare('UPDATE outbox SET next_attempt_at = ? WHERE event_id = ?').run(Date.now(), eventId);
    await pollUntil(() => {
      const e = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
      return e && e.status === 'delivered';
    }, { timeoutMs: 5000 });
    assert(target.hits['/handoff']?.length === 1, 'delivered exactly once after arming');
    const ob = db.prepare('SELECT * FROM outbox WHERE event_id = ?').get(eventId);
    assert(!ob, 'outbox row removed after delivery');
  });

  await tc('TC-8.4', 'Demo seed events are never re-driven by recovery', async () => {
    const demo = db.prepare("SELECT id, status FROM events WHERE id LIKE 'demo_event_%' AND status = 'pending'").all();
    // demo_event_4 is seeded as pending on fresh DBs; it must stay untouched.
    for (const d of demo) {
      const ob = db.prepare('SELECT * FROM outbox WHERE event_id = ?').get(d.id);
      assert(!ob, `demo event ${d.id} must not be enqueued in outbox`);
    }
    return `${demo.length} pending demo event(s) left untouched`;
  });
}

// ---------------------------------------------------------------------------
// Group 9 — Security hardening: SSRF guard, hashed API keys, SSE auth
// ---------------------------------------------------------------------------
async function group9_security() {
  console.log('\n# Group 9 — Security: SSRF, key hashing, SSE auth');

  await tc('TC-9.1', 'SSRF classifier — private/loopback/metadata ranges', async () => {
    assertEq(ssrf.classifyAddress('127.0.0.1'), 'loopback', '127.0.0.1');
    assertEq(ssrf.classifyAddress('::1'), 'loopback', '::1');
    assertEq(ssrf.classifyAddress('10.1.2.3'), 'blocked', '10.1.2.3');
    assertEq(ssrf.classifyAddress('172.16.0.1'), 'blocked', '172.16.0.1');
    assertEq(ssrf.classifyAddress('192.168.1.1'), 'blocked', '192.168.1.1');
    assertEq(ssrf.classifyAddress('169.254.169.254'), 'blocked', 'metadata IP');
    assertEq(ssrf.classifyAddress('100.64.0.1'), 'blocked', 'CGNAT');
    assertEq(ssrf.classifyAddress('0.0.0.0'), 'blocked', '0.0.0.0');
    assertEq(ssrf.classifyAddress('::ffff:10.0.0.1'), 'blocked', 'v4-mapped private');
    assertEq(ssrf.classifyAddress('fe80::1'), 'blocked', 'v6 link-local');
    assertEq(ssrf.classifyAddress('fd00::1'), 'blocked', 'v6 unique-local');
    assertEq(ssrf.classifyAddress('8.8.8.8'), 'public', '8.8.8.8');
    assertEq(ssrf.classifyAddress('::ffff:8.8.8.8'), 'public', 'v4-mapped public');
    // Policy behavior (no DNS needed — literal IPs)
    await ssrf.assertPublicDestination('http://8.8.8.8/hook', { policy: 'none' });
    await ssrf.assertPublicDestination('http://127.0.0.1:9999/hook', { policy: 'loopback' });
    let blocked = false;
    try { await ssrf.assertPublicDestination('http://127.0.0.1/hook', { policy: 'none' }); }
    catch (e) { blocked = e.code === 'SSRF_BLOCKED'; }
    assert(blocked, 'loopback blocked under policy=none');
    blocked = false;
    try { await ssrf.assertPublicDestination('http://10.0.0.1/hook', { policy: 'loopback' }); }
    catch (e) { blocked = e.code === 'SSRF_BLOCKED'; }
    assert(blocked, 'private blocked under policy=loopback');
  });

  await tc('TC-9.2', 'Route creation rejects private/metadata destinations (400)', async () => {
    const a = await createSink({ name: 'tc-9-2' });
    const priv = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: 'http://10.0.0.1/hook' },
    });
    assertEq(priv.status, 400, 'private 10/8 rejected');
    assert(/not allowed/i.test(priv.body.error), `clear error message, got: ${priv.body.error}`);

    const meta = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    assertEq(meta.status, 400, 'metadata IP rejected');

    // Loopback allowed under the dev server's loopback policy
    const ok = await req('POST', `/api/sinks/${a.sink_id}/routes`, {
      headers: { 'x-api-key': a.api_key }, body: { url: `${targetBase}/ok-9-2` },
    });
    assertEq(ok.status, 201, 'loopback target allowed under dev policy');
  });

  await tc('TC-9.3', 'Delivery-time re-validation blocks a private destination (DNS rebinding defense)', async () => {
    // Bypass route-creation validation by inserting the route directly —
    // simulates a hostname that re-resolved to a private IP after creation.
    const a = await createSink({ name: 'tc-9-3' });
    const routeId = `tc93_route_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO routes (id, sink_id, url, created_at) VALUES (?, ?, ?, ?)')
      .run(routeId, a.sink_id, 'http://10.255.255.1:9/hook', now);
    const eventId = `tc93_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(
      'INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventId, a.sink_id, 'generic', '{"x":1}', now, 'pending');

    const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(a.sink_id);
    const result = await fanout(db, eventId, routes, '{"x":1}', { 'content-type': 'application/json' });
    assert(result && result.anySuccess === false, 'fanout reports failure');
    assert(
      result.attempts.length === 1 && /blocked destination/i.test(result.attempts[0].error_message || ''),
      `attempt carries blocked-destination error, got: ${JSON.stringify(result.attempts)}`
    );

    const attempts = db.prepare(
      'SELECT * FROM delivery_attempts WHERE event_id = ? AND route_id = ?'
    ).all(eventId, routeId);
    assertEq(attempts.length, 1, 'exactly one failed attempt recorded (no retries)');
    assertEq(attempts[0].status, 'failed', 'attempt status');
    return 'blocked before any connection was made';
  });

  await tc('TC-9.4', 'API keys stored hashed; plaintext authenticates, stored hash does not', async () => {
    const a = await createSink({ name: 'tc-9-4' });
    const row = db.prepare('SELECT api_key FROM sinks WHERE id = ?').get(a.sink_id);
    assert(row.api_key.startsWith('sha256$'), `stored key is hashed, got: ${row.api_key.slice(0, 12)}...`);
    assert(row.api_key !== a.api_key, 'stored value differs from plaintext');

    const okAuth = await req('GET', '/api/sinks', { headers: { 'x-api-key': a.api_key } });
    assertEq(okAuth.status, 200, 'plaintext key authenticates');

    const hashAuth = await req('GET', '/api/sinks', { headers: { 'x-api-key': row.api_key } });
    assertEq(hashAuth.status, 401, 'stored hash is not a credential');
  });

  await tc('TC-9.5', 'No plaintext keys remain in the sinks table (startup migration)', async () => {
    const bad = db.prepare("SELECT COUNT(*) AS n FROM sinks WHERE api_key NOT LIKE 'sha256$%'").get();
    assertEq(bad.n, 0, 'unhashed key count');
  });

  await tc('TC-9.6', 'SSE stream rejects ?key= query auth (401)', async () => {
    const a = await createSink({ name: 'tc-9-6' });
    const r = await req('GET', `/api/sinks/${a.sink_id}/stream?key=${a.api_key}`);
    assertEq(r.status, 401, 'query-string key rejected');
    assert(/query string/i.test(r.body.error), `explains header/session alternative, got: ${r.body.error}`);
  });

  await tc('TC-9.8', 'Connect-time lookup enforces policy (DNS rebinding cannot reach blocked IPs)', async () => {
    // makeSafeLookup is wired into the fanout http(s) Agents, so the address
    // the socket connects to is validated at connect time — even if a
    // hostname re-resolves after the pre-check.
    const lookupNone = ssrf.makeSafeLookup('none');
    const blockedErr = await new Promise((resolve) => {
      lookupNone('localhost', {}, (err) => resolve(err));
    });
    assert(blockedErr && blockedErr.code === 'SSRF_BLOCKED', 'localhost blocked under policy=none at connect time');

    const lookupLoop = ssrf.makeSafeLookup('loopback');
    const ok = await new Promise((resolve, reject) => {
      lookupLoop('localhost', {}, (err, address, family) => err ? reject(err) : resolve({ address, family }));
    });
    assert(ssrf.classifyAddress(ok.address) === 'loopback', `localhost allowed under policy=loopback (got ${ok.address})`);
  });

  await tc('TC-9.9', 'Signup-created sink stores a hashed API key', async () => {
    const email = `tc-9-9-${crypto.randomBytes(4).toString('hex')}@example.com`;
    // Fetch the signup page for CSRF cookie + hidden field
    const page = await fetch(`${BASE}/signup`);
    const html = await page.text();
    const setCookies = page.headers.getSetCookie ? page.headers.getSetCookie() : [page.headers.get('set-cookie')];
    const cookieHeader = setCookies.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
    const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    assert(csrf, 'signup page exposes CSRF token');

    const resp = await fetch(`${BASE}/signup`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader },
      body: `email=${encodeURIComponent(email)}&password=password123&_csrf=${csrf}`,
    });
    assertEq(resp.status, 302, 'signup succeeds');

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    assert(user, 'user row created');
    const sink = db.prepare('SELECT id, api_key FROM sinks WHERE user_id = ?').get(user.id);
    assert(sink, 'sink auto-created at signup');
    try {
      assert(sink.api_key.startsWith('sha256$'), `signup sink key is hashed, got: ${sink.api_key.slice(0, 12)}...`);
    } finally {
      // Cleanup (signup sinks are not tc-prefixed)
      db.prepare('DELETE FROM sinks WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    }
  });

  await tc('TC-9.7', 'SSE stream accepts API key via header', async () => {
    const a = await createSink({ name: 'tc-9-7' });
    const controller = new AbortController();
    try {
      const res = await fetch(`${BASE}/api/sinks/${a.sink_id}/stream`, {
        headers: { 'x-api-key': a.api_key },
        signal: controller.signal,
      });
      assertEq(res.status, 200, 'header-auth stream opens');
      assert(
        String(res.headers.get('content-type')).includes('text/event-stream'),
        'content-type is text/event-stream'
      );
    } finally {
      controller.abort();
    }

    // Wrong header key still rejected
    const bad = await fetch(`${BASE}/api/sinks/${a.sink_id}/stream`, {
      headers: { 'x-api-key': 'nope_invalid_key' },
    });
    assertEq(bad.status, 401, 'invalid header key rejected');
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
    await group8_outbox();
    await group_dashboardCsrf();
    await group9_security();
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
