#!/usr/bin/env node
/**
 * Integration tests for lib/nats.js and workers/delivery.js.
 *
 * Requires a running nats-server with JetStream on $NATS_URL (default
 * nats://localhost:4222). Cleans up the WEBHOOKS, DLQ streams and the
 * delivery-worker consumer between runs so it is idempotent.
 *
 * Tests are end-to-end and exercise:
 *   - lib/nats.js: connect, stream/consumer setup, publish, publishToDLQ,
 *     listDLQMessages, deleteDLQMessage, publishStatusEvent, disconnect
 *   - workers/delivery.js (in-process import): processMessage cascade
 *     (success, no-routes-DLQ, max-deliver-DLQ, transient-nak)
 *
 * Run with:  node tests/run-nats-tests.js
 * Exits 0 on full pass / non-zero on any failure.
 */

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const fsBoot = require('fs');

// Speed up fanout retries (also picked up by the live worker if restarted)
process.env.FANHOOK_RETRY_DELAYS_MS = process.env.FANHOOK_RETRY_DELAYS_MS || '0,50,50';

// ---------------------------------------------------------------------------
// Boot a private nats-server (JetStream) on an ephemeral port so this test
// is self-contained. The Replit workflow framework polls HTTP, which NATS
// does not speak, so spawning inline avoids the workflow lifecycle entirely.
// ---------------------------------------------------------------------------
function pickPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}
function waitFor(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => {
        s.end(); resolve();
      });
      s.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`nats-server did not open ${port}`));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}
let natsProc;
async function bootNats() {
  const port = await pickPort();
  const dataDir = `/tmp/nats-jetstream-test-${process.pid}`;
  try { fsBoot.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  natsProc = spawn('nats-server', ['-js', '-sd', dataDir, '-p', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  natsProc.on('exit', (code, sig) => {
    if (!shuttingDown) console.error(`[nats-server] exited unexpectedly code=${code} sig=${sig}`);
  });
  await waitFor(port);
  process.env.NATS_URL = `nats://127.0.0.1:${port}`;
  return { port, dataDir };
}
let shuttingDown = false;
function killNats() {
  shuttingDown = true;
  if (natsProc && !natsProc.killed) {
    try { natsProc.kill('SIGTERM'); } catch (_) {}
  }
}

// natsLib, db, and the worker harness are loaded after bootNats() in main(),
// so that lib/nats.js captures the right NATS_URL at module load.
let natsLib, db, processMessage, runConsumeLoop;
function loadModulesUnderTest() {
  natsLib = require(path.join(__dirname, '..', 'lib', 'nats'));
  db = require(path.join(__dirname, '..', 'db'));
  // Load workers/delivery.js with its bottom-side-effects stripped so we can
  // drive processMessage in-process.
  const Module = require('module');
  const fs = require('fs');
  const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'workers', 'delivery.js'), 'utf8');
  const sanitized = workerSrc
    .replace(/startWorker\(\)\.catch\([\s\S]*?\}\);\s*$/m, '')
    .replace(/process\.on\('SIGTERM'[\s\S]*?\}\);\s*/g, '')
    .replace(/process\.on\('SIGINT'[\s\S]*?\}\);\s*/g, '')
    + '\nmodule.exports = { processMessage, writeToDLQ, runConsumeLoop };\n';
  const workerMod = new Module(path.join(__dirname, '..', 'workers', 'delivery.harness.js'));
  workerMod.filename = path.join(__dirname, '..', 'workers', 'delivery.harness.js');
  workerMod.paths = Module._nodeModulePaths(workerMod.filename);
  workerMod._compile(sanitized, workerMod.filename);
  processMessage = workerMod.exports.processMessage;
  runConsumeLoop = workerMod.exports.runConsumeLoop;
}

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------
const results = [];
const TC_TIMEOUT_MS = 8000;
async function tc(id, title, fn) {
  const start = Date.now();
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timed out after ${TC_TIMEOUT_MS}ms`)), TC_TIMEOUT_MS);
  });
  try {
    const note = await Promise.race([Promise.resolve().then(fn), timeout]);
    clearTimeout(timer);
    const ms = Date.now() - start;
    results.push({ id, title, status: 'PASS', ms, note: note || '' });
    console.log(`  PASS  ${id} (${ms}ms) ${title}${note ? ' — ' + note : ''}`);
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - start;
    const msg = err && err.message ? err.message : String(err);
    results.push({ id, title, status: 'FAIL', ms, note: msg });
    console.log(`  FAIL  ${id} (${ms}ms) ${title}\n        ${msg}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, label) {
  if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function uid(prefix) { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Local HTTP target (acts as webhook destination)
// ---------------------------------------------------------------------------
let targetServer; let targetBase; const targetHits = [];
let nextStatus = 200;
function startTarget() {
  return new Promise((resolve) => {
    targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        targetHits.push({ url: req.url, headers: req.headers, body });
        // /slow* paths simulate a stalled destination (2s before responding)
        const delay = req.url.startsWith('/slow') ? 2000 : 0;
        setTimeout(() => {
          res.statusCode = nextStatus;
          res.end('ok');
        }, delay);
      });
    });
    targetServer.listen(0, '127.0.0.1', () => {
      const { port } = targetServer.address();
      targetBase = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}
function stopTarget() { return new Promise((r) => targetServer ? targetServer.close(r) : r()); }

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------
async function purgeStreams() {
  const conn = await natsLib.getConnection();
  const jsm = await conn.jetstreamManager();
  for (const name of [natsLib.STREAM_NAME, natsLib.DLQ_STREAM_NAME]) {
    try { await jsm.streams.purge(name); } catch (_) {}
  }
}
function cleanFixtures() {
  db.prepare("DELETE FROM delivery_attempts WHERE event_id IN (SELECT id FROM events WHERE id LIKE 'natstest_%')").run();
  db.prepare("DELETE FROM events WHERE id LIKE 'natstest_%'").run();
  db.prepare("DELETE FROM dlq_entries WHERE event_id LIKE 'natstest_%'").run();
  db.prepare("DELETE FROM routes WHERE sink_id LIKE 'natstest_%'").run();
  db.prepare("DELETE FROM sinks WHERE id LIKE 'natstest_%'").run();
}

function makeSink({ routes = [] } = {}) {
  const sinkId = uid('natstest_sink');
  const apiKey = uid('natstest_key');
  db.prepare(
    "INSERT INTO sinks (id, name, provider, api_key, created_at, tier) VALUES (?, ?, 'generic', ?, ?, 'free')"
  ).run(sinkId, sinkId, apiKey, new Date().toISOString());
  for (const url of routes) {
    db.prepare(
      'INSERT INTO routes (id, sink_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(uid('natstest_route'), sinkId, url, new Date().toISOString());
  }
  return { sinkId, apiKey };
}

function makeEvent(sinkId, status = 'pending') {
  const eventId = uid('natstest_event');
  db.prepare(
    "INSERT INTO events (id, sink_id, provider, payload, received_at, status) VALUES (?, ?, 'generic', ?, ?, ?)"
  ).run(eventId, sinkId, JSON.stringify({ hello: 'world' }), new Date().toISOString(), status);
  return eventId;
}

// Build a fake JetStream message that processMessage understands
function fakeMsg({ eventId, sinkId, rawBodyB64 = null, headers = {}, deliveryCount = 1 }) {
  const data = { eventId, sinkId, rawBodyB64, headers };
  let acked = false; let naked = null; let working = 0;
  return {
    data: natsLib.jc.encode(data),
    info: { deliveryCount, streamSequence: 1 },
    ack() { acked = true; },
    nak(delay) { naked = delay; },
    working() { working += 1; },
    _state() { return { acked, naked, working }; },
  };
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------
async function group_natsLib() {
  console.log('\n# Group N — lib/nats.js');

  await tc('TC-N.1', 'getConnection() returns a usable client and is idempotent', async () => {
    const a = await natsLib.getConnection();
    const b = await natsLib.getConnection();
    assert(a === b, 'should return same singleton');
    assert(typeof a.publish === 'function', 'has publish');
  });

  await tc('TC-N.2', 'Stream WEBHOOKS and DLQ exist with expected configs', async () => {
    const conn = await natsLib.getConnection();
    const jsm = await conn.jetstreamManager();
    const wh = await jsm.streams.info(natsLib.STREAM_NAME);
    const dlq = await jsm.streams.info(natsLib.DLQ_STREAM_NAME);
    assert(wh.config.subjects.includes(`${natsLib.SUBJECT_PREFIX}.*`), 'WEBHOOKS subject');
    assert(dlq.config.subjects.includes(`${natsLib.DLQ_SUBJECT_PREFIX}.*`), 'DLQ subject');
    assertEq(dlq.config.max_msgs_per_subject, 500, 'DLQ max_msgs_per_subject');
  });

  await tc('TC-N.3', 'Consumer "delivery-worker" exists with max_deliver=3', async () => {
    const conn = await natsLib.getConnection();
    const jsm = await conn.jetstreamManager();
    const info = await jsm.consumers.info(natsLib.STREAM_NAME, 'delivery-worker');
    assertEq(info.config.max_deliver, natsLib.MAX_DELIVER, 'max_deliver');
    assertEq(info.config.durable_name, 'delivery-worker', 'durable_name');
  });

  await tc('TC-N.4', 'publish() lands a message on webhook.ingest.<sinkId>', async () => {
    const sinkId = uid('natstest_sink');
    await natsLib.publish(sinkId, { eventId: 'e1', sinkId, rawBodyB64: 'aGk=', headers: {} });
    const conn = await natsLib.getConnection();
    const jsm = await conn.jetstreamManager();
    const info = await jsm.streams.info(natsLib.STREAM_NAME);
    assert(info.state.messages >= 1, 'WEBHOOKS has at least 1 message');
  });

  await tc('TC-N.5', 'publishToDLQ() returns a PubAck with seq, listDLQMessages reads it back', async () => {
    const sinkId = uid('natstest_sink');
    const ack = await natsLib.publishToDLQ(sinkId, {
      event_id: 'evt-1', sink_id: sinkId, payload: 'eA==', headers: { a: 'b' },
      failed_at: new Date().toISOString(), attempt_count: 3, failure_reason: 'oops',
    });
    assert(ack && ack.seq, 'PubAck.seq present');

    // Publish a second so we can verify ordering (newest-first)
    const ack2 = await natsLib.publishToDLQ(sinkId, {
      event_id: 'evt-2', sink_id: sinkId, payload: 'eQ==', headers: {},
      failed_at: new Date().toISOString(), attempt_count: 3, failure_reason: 'oops2',
    });
    assert(ack2.seq > ack.seq, 'second seq > first');

    const list = await natsLib.listDLQMessages(sinkId, 50);
    assertEq(list.length, 2, 'list length');
    assertEq(list[0].event_id, 'evt-2', 'newest first');
    assertEq(list[1].event_id, 'evt-1', 'older second');
    assert(typeof list[0]._nats_seq === 'number', '_nats_seq populated');
    return `seqs: ${list[0]._nats_seq}, ${list[1]._nats_seq}`;
  });

  await tc('TC-N.6', 'listDLQMessages returns [] for an unknown sink with no messages', async () => {
    const list = await natsLib.listDLQMessages(uid('natstest_empty'), 10);
    assertEq(list.length, 0, 'empty list');
  });

  await tc('TC-N.7', 'deleteDLQMessage removes a specific seq from the DLQ stream', async () => {
    const sinkId = uid('natstest_sink');
    const ack = await natsLib.publishToDLQ(sinkId, {
      event_id: 'evt-del', sink_id: sinkId, payload: '', headers: {},
      failed_at: new Date().toISOString(), attempt_count: 3, failure_reason: 'gone',
    });
    let list = await natsLib.listDLQMessages(sinkId, 10);
    assertEq(list.length, 1, 'present before delete');
    await natsLib.deleteDLQMessage(ack.seq);
    list = await natsLib.listDLQMessages(sinkId, 10);
    assertEq(list.length, 0, 'absent after delete');
  });

  await tc('TC-N.8', 'publishStatusEvent fires-and-forgets on the events.status.<sinkId> subject', async () => {
    // Subscribe first, then publish, then assert one delivery.
    const conn = await natsLib.getConnection();
    const sinkId = uid('natstest_sink');
    const sub = conn.subscribe(`events.status.${sinkId}`);
    let received = null;
    const reader = (async () => {
      for await (const m of sub) { received = natsLib.jc.decode(m.data); break; }
    })();
    await natsLib.publishStatusEvent(sinkId, { event_id: 'e', sink_id: sinkId, status: 'delivered' });
    // wait briefly
    await Promise.race([reader, sleep(500)]);
    sub.unsubscribe();
    assert(received && received.status === 'delivered', 'status event observed');
  });
}

async function group_worker() {
  console.log('\n# Group W — workers/delivery.js (in-process processMessage)');

  await tc('TC-W.1', 'Happy path: 1 working route → ack + event delivered', async () => {
    nextStatus = 200; targetHits.length = 0;
    const { sinkId } = makeSink({ routes: [`${targetBase}/ok`] });
    const eventId = makeEvent(sinkId);
    const msg = fakeMsg({ eventId, sinkId, rawBodyB64: Buffer.from('{"a":1}').toString('base64') });
    await processMessage(msg);
    const state = msg._state();
    assert(state.acked, 'acked');
    assert(!state.naked, 'not naked');
    const evt = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    assertEq(evt.status, 'delivered', 'event status');
    assert(targetHits.length >= 1, 'destination received body');
  });

  await tc('TC-W.2', 'No routes → marked failed + DLQ row written + ack', async () => {
    const { sinkId } = makeSink({ routes: [] });
    const eventId = makeEvent(sinkId);
    const msg = fakeMsg({ eventId, sinkId });
    await processMessage(msg);
    assert(msg._state().acked, 'acked');
    const evt = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    assertEq(evt.status, 'failed', 'event marked failed');
    const dlq = db.prepare('SELECT * FROM dlq_entries WHERE event_id = ?').get(eventId);
    assert(dlq, 'DLQ row exists');
    assertEq(dlq.failure_reason, 'no_routes', 'DLQ reason');
  });

  await tc('TC-W.3', 'Transient failure (deliveryCount<3) → nak with 30s delay, event reset to pending', async () => {
    nextStatus = 503; targetHits.length = 0;
    const { sinkId } = makeSink({ routes: [`${targetBase}/fail`] });
    const eventId = makeEvent(sinkId);
    const msg = fakeMsg({ eventId, sinkId, deliveryCount: 1 });
    await processMessage(msg);
    const state = msg._state();
    assert(!state.acked, 'not acked');
    assertEq(state.naked, 30_000, 'nak delay = 30s');
    const evt = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    assertEq(evt.status, 'pending', 'event reset to pending');
  });

  await tc('TC-W.4', 'Final exhaustion (deliveryCount=3) → DLQ + failed + ack', async () => {
    nextStatus = 503; targetHits.length = 0;
    const { sinkId } = makeSink({ routes: [`${targetBase}/fail`] });
    const eventId = makeEvent(sinkId);
    const msg = fakeMsg({ eventId, sinkId, deliveryCount: natsLib.MAX_DELIVER });
    await processMessage(msg);
    assert(msg._state().acked, 'acked');
    const evt = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    assertEq(evt.status, 'failed', 'event marked failed');
    const dlq = db.prepare('SELECT * FROM dlq_entries WHERE event_id = ?').get(eventId);
    assert(dlq, 'DLQ row written');
    assertEq(dlq.failure_reason, 'max_deliver_exceeded', 'DLQ reason');
    assert(dlq.nats_seq, 'NATS seq stored on DLQ row');
  });

  await tc('TC-W.5', 'Already-delivered event short-circuits (no destination call)', async () => {
    nextStatus = 200; targetHits.length = 0;
    const { sinkId } = makeSink({ routes: [`${targetBase}/ok`] });
    const eventId = makeEvent(sinkId, 'delivered');
    const msg = fakeMsg({ eventId, sinkId });
    await processMessage(msg);
    assert(msg._state().acked, 'acked');
    assertEq(targetHits.length, 0, 'no destination call');
  });

  await tc('TC-W.6', 'Missing event row → ack to discard', async () => {
    const msg = fakeMsg({ eventId: 'natstest_missing_xyz', sinkId: 'natstest_no' });
    await processMessage(msg);
    assert(msg._state().acked, 'acked');
  });

  await tc('TC-W.7', 'Concurrent consume: slow destination does not block other sinks', async () => {
    nextStatus = 200; targetHits.length = 0;
    const slow = makeSink({ routes: [`${targetBase}/slow-w7`] });
    const fast = makeSink({ routes: [`${targetBase}/ok-w7`] });
    const slowEventId = makeEvent(slow.sinkId);
    const fastEventId = makeEvent(fast.sinkId);
    const slowMsg = fakeMsg({ eventId: slowEventId, sinkId: slow.sinkId, rawBodyB64: Buffer.from('{"s":1}').toString('base64') });
    const fastMsg = fakeMsg({ eventId: fastEventId, sinkId: fast.sinkId, rawBodyB64: Buffer.from('{"f":1}').toString('base64') });

    async function* gen() { yield slowMsg; yield fastMsg; }
    const loopDone = runConsumeLoop(gen(), { concurrency: 4 });

    // The fast event must be delivered while the slow one (2s destination
    // delay) is still in flight. A serial loop would take >2s to reach it.
    const deadline = Date.now() + 1500;
    let fastDeliveredEarly = false;
    while (Date.now() < deadline) {
      const f = db.prepare('SELECT status FROM events WHERE id = ?').get(fastEventId);
      if (f && f.status === 'delivered') {
        const s = db.prepare('SELECT status FROM events WHERE id = ?').get(slowEventId);
        assert(s.status !== 'delivered', 'slow event still in flight when fast one finished');
        fastDeliveredEarly = true;
        break;
      }
      await sleep(50);
    }
    assert(fastDeliveredEarly, 'fast event delivered while slow destination was stalling');

    await loopDone;
    assert(slowMsg._state().acked, 'slow msg eventually acked');
    assert(fastMsg._state().acked, 'fast msg acked');
    const s = db.prepare('SELECT status FROM events WHERE id = ?').get(slowEventId);
    assertEq(s.status, 'delivered', 'slow event delivered after stall');
  });

  await tc('TC-W.8', 'Concurrency cap respected and duplicate in-flight events deferred', async () => {
    let active = 0; let maxActive = 0; let handled = 0;
    const handler = async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await sleep(100);
      handled += 1; active -= 1;
    };
    const msgs = [];
    for (let i = 0; i < 6; i++) {
      msgs.push(fakeMsg({ eventId: `natstest_cap_${i}`, sinkId: 'natstest_cap_sink' }));
    }
    // Duplicate of an in-flight event — must be naked, not double-processed
    const dup = fakeMsg({ eventId: 'natstest_cap_0', sinkId: 'natstest_cap_sink' });
    async function* gen() { yield msgs[0]; yield dup; for (const m of msgs.slice(1)) yield m; }
    await runConsumeLoop(gen(), { concurrency: 2, handler });
    assertEq(maxActive, 2, 'max concurrent handlers');
    assertEq(handled, 6, 'all six unique messages handled');
    assertEq(dup._state().naked, 1000, 'duplicate in-flight event naked with 1s delay');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('FanHook NATS + delivery worker integration tests');
  const { port } = await bootNats();
  console.log(`Spawned nats-server on 127.0.0.1:${port}`);
  loadModulesUnderTest();
  console.log(`NATS_URL = ${natsLib.NATS_URL}`);

  await startTarget();
  console.log(`HTTP target on ${targetBase}\n`);

  try {
    cleanFixtures();
    await purgeStreams();
    await group_natsLib();
    await purgeStreams();
    cleanFixtures();
    await group_worker();
  } finally {
    cleanFixtures();
    try { await purgeStreams(); } catch (_) {}
    try { await natsLib.disconnect(); } catch (_) {}
    await stopTarget();
    killNats();
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n──────────────────────────────────────────`);
  console.log(`Total: ${results.length}    PASS: ${passed}    FAIL: ${failed}`);
  console.log(`──────────────────────────────────────────`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  ${r.id}  ${r.title}\n    ${r.note}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
