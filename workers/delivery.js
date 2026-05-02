/**
 * workers/delivery.js
 *
 * Durable NATS JetStream delivery worker for FanHook.
 *
 * Subscribes to the WEBHOOKS stream as the "delivery-worker" durable consumer.
 * For each message:
 *   1. Decodes rawBodyB64 + headers from the NATS message payload
 *   2. Fans out to all destination URLs in parallel (via lib/fanout.js)
 *   3. Acks on success; naks with 30 s delay on failure so JetStream redelivers
 *   4. On final exhaustion (deliveryCount >= MAX_DELIVER): writes to DLQ, marks event failed, acks
 *
 * Can run as a forked child process (spawned by server.js) or standalone:
 *   node workers/delivery.js
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'db'));
const { fanout } = require(path.join(__dirname, '..', 'lib', 'fanout'));
const natsLib = require(path.join(__dirname, '..', 'lib', 'nats'));

const NAK_DELAY_MS = 30_000;

async function writeToDLQ(eventId, sinkId, provider, rawBodyB64, headers, attemptCount, failureReason) {
  const failedAt = new Date().toISOString();

  // Write to SQLite for raw-body storage (used by redrive endpoint)
  db.prepare(`
    INSERT OR IGNORE INTO dlq_entries
      (event_id, sink_id, raw_body_b64, headers, provider, failed_at, attempt_count, failure_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    sinkId,
    rawBodyB64 || '',
    JSON.stringify(headers || {}),
    provider || null,
    failedAt,
    attemptCount,
    failureReason || null
  );

  // Publish to NATS DLQ stream (primary store for list endpoint).
  // Store the returned stream sequence in SQLite so the redrive endpoint can
  // delete this specific message from the stream later.
  try {
    const pubAck = await natsLib.publishToDLQ(sinkId, {
      event_id: eventId,
      sink_id: sinkId,
      payload: rawBodyB64 || '',
      headers: headers || {},
      failed_at: failedAt,
      attempt_count: attemptCount,
      failure_reason: failureReason || null,
    });
    if (pubAck && pubAck.seq) {
      db.prepare('UPDATE dlq_entries SET nats_seq = ? WHERE event_id = ?').run(pubAck.seq, eventId);
    }
  } catch (_) {
    // NATS DLQ publish failure is non-fatal — redrive still works via SQLite
  }

  console.warn(`[delivery] Event ${eventId} written to DLQ (${attemptCount} attempts, reason: ${failureReason})`);
}

async function processMessage(msg) {
  let data;
  try {
    data = natsLib.jc.decode(msg.data);
  } catch (err) {
    console.error('[delivery] Failed to decode message:', err.message);
    msg.ack();
    return;
  }

  const { eventId, sinkId, rawBodyB64, headers } = data;
  const deliveryCount = msg.info ? msg.info.deliveryCount : 1;

  console.log(`[delivery] Processing event ${eventId} (delivery #${deliveryCount})`);

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    console.warn(`[delivery] Event ${eventId} not found in DB — acking to discard`);
    msg.ack();
    return;
  }

  if (event.status === 'delivered') {
    console.log(`[delivery] Event ${eventId} already delivered — acking`);
    msg.ack();
    return;
  }

  const routes = db.prepare('SELECT * FROM routes WHERE sink_id = ?').all(sinkId);
  if (routes.length === 0) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    console.warn(`[delivery] No routes for sink ${sinkId} — marking failed, writing to DLQ`);
    await writeToDLQ(eventId, sinkId, event.provider, rawBodyB64, headers, deliveryCount, 'no_routes');
    msg.ack();
    natsLib.publishStatusEvent(sinkId, { event_id: eventId, sink_id: sinkId, status: 'failed' }).catch(() => {});
    return;
  }

  // Reconstruct the original raw body from the base64-encoded NATS payload.
  // If rawBodyB64 is missing (legacy message), fall back to the SQLite payload.
  const rawBody = rawBodyB64
    ? Buffer.from(rawBodyB64, 'base64')
    : Buffer.from(event.payload || '{}');

  // Use the original request headers from the NATS message for exact fidelity.
  const forwardHeaders = headers || {};

  // Send periodic in-progress signals to JetStream so it does not redeliver
  // while fanout is still running. Worst-case fanout duration is ~150 s
  // (3 routes × in-process retries with 0s + 30s + 120s delays). Calling
  // msg.working() every 20 s resets the server-side ack_wait timer.
  const workingInterval = setInterval(() => {
    try { msg.working(); } catch (_) {}
  }, 20_000);

  let succeeded = false;
  let fanoutResult = { anySuccess: false, attempts: [] };
  try {
    fanoutResult = await fanout(db, eventId, routes, rawBody, forwardHeaders);
    succeeded = fanoutResult.anySuccess;
  } catch (err) {
    console.error(`[delivery] fanout error for event ${eventId}:`, err.message);
  } finally {
    clearInterval(workingInterval);
  }

  // Build a concise attempt summary for SSE consumers (last attempt per route)
  const attemptSummary = fanoutResult.attempts.map(({ route_id, http_status, attempt_number, error_message }) => ({
    route_id,
    http_status,
    attempt_number,
    error_message,
  }));

  if (succeeded) {
    console.log(`[delivery] Event ${eventId} delivered — acking`);
    msg.ack();
    natsLib.publishStatusEvent(sinkId, {
      event_id: eventId,
      sink_id: sinkId,
      status: 'delivered',
      attempt_number: attemptSummary.length > 0 ? attemptSummary[0].attempt_number : 1,
      http_status: attemptSummary.length > 0 ? attemptSummary[0].http_status : null,
      error_message: null,
      attempts: attemptSummary,
    }).catch(() => {});
  } else if (deliveryCount >= natsLib.MAX_DELIVER) {
    // All JetStream redeliveries exhausted — write to DLQ before final ack.
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    console.warn(`[delivery] Event ${eventId} exhausted ${natsLib.MAX_DELIVER} attempts — writing to DLQ, acking`);
    await writeToDLQ(eventId, sinkId, event.provider, rawBodyB64, headers, deliveryCount, 'max_deliver_exceeded');
    msg.ack();
    natsLib.publishStatusEvent(sinkId, {
      event_id: eventId,
      sink_id: sinkId,
      status: 'failed',
      attempt_number: attemptSummary.length > 0 ? attemptSummary[0].attempt_number : deliveryCount,
      http_status: attemptSummary.length > 0 ? attemptSummary[0].http_status : null,
      error_message: attemptSummary.length > 0 ? attemptSummary[0].error_message : 'max_deliver_exceeded',
      attempts: attemptSummary,
    }).catch(() => {});
  } else {
    // Transient failure — reset event to 'pending' so the UI does not show a
    // false permanent failure while JetStream redelivery is in progress.
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('pending', eventId);
    console.log(`[delivery] Event ${eventId} failed — resetting to pending, naking for redelivery in ${NAK_DELAY_MS / 1000}s`);
    msg.nak(NAK_DELAY_MS);
  }
}

async function startWorker() {
  console.log(`[delivery] Starting — connecting to NATS at ${natsLib.NATS_URL}`);

  try {
    await natsLib.getConnection();
  } catch (err) {
    // NATS is not reachable. Exit cleanly so server.js does not restart the
    // worker in an infinite loop — the ingest route will use direct fanout.
    console.warn(`[delivery] NATS unavailable (${err.message}) — exiting cleanly; direct fanout active`);
    process.exit(0);
  }

  console.log('[delivery] Connected — consuming from WEBHOOKS stream as "delivery-worker"');

  try {
    const js = await natsLib.getJetStream();
    const consumer = await js.consumers.get(natsLib.STREAM_NAME, 'delivery-worker');
    const messages = await consumer.consume();

    for await (const msg of messages) {
      await processMessage(msg);
    }
  } catch (err) {
    // Unexpected runtime error — exit with non-zero so server.js restarts us
    console.error('[delivery] Worker runtime error:', err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('[delivery] SIGTERM received — draining NATS and shutting down');
  await natsLib.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await natsLib.disconnect();
  process.exit(0);
});

startWorker().catch((err) => {
  console.error('[delivery] Fatal startup error:', err);
  process.exit(1);
});
