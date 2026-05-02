/**
 * workers/delivery.js
 *
 * Durable NATS JetStream delivery worker for FanHook.
 *
 * Subscribes to the WEBHOOKS stream as the "delivery-worker" durable consumer.
 * For each message:
 *   1. Reads the event and routes from SQLite
 *   2. Fans out to all destination URLs in parallel (via lib/fanout.js)
 *   3. Acks on success; naks with 30 s delay on failure so JetStream redelivers
 *   4. On final exhaustion (deliveryCount >= MAX_DELIVER): marks event failed, acks
 *
 * Can run as a forked child process (spawned by server.js) or standalone:
 *   node workers/delivery.js
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'db'));
const { fanout } = require(path.join(__dirname, '..', 'lib', 'fanout'));
const natsLib = require(path.join(__dirname, '..', 'lib', 'nats'));

const NAK_DELAY_MS = 30_000;

async function processMessage(msg) {
  let data;
  try {
    data = natsLib.jc.decode(msg.data);
  } catch (err) {
    console.error('[delivery] Failed to decode message:', err.message);
    msg.ack();
    return;
  }

  const { eventId, sinkId, contentType } = data;
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
    console.warn(`[delivery] No routes for sink ${sinkId} — marking failed`);
    msg.ack();
    return;
  }

  const rawBody = Buffer.from(event.payload || '{}');
  const headers = contentType ? { 'content-type': contentType } : {};

  let succeeded = false;
  try {
    await fanout(db, eventId, routes, rawBody, headers);
    const updated = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    succeeded = updated && updated.status === 'delivered';
  } catch (err) {
    console.error(`[delivery] fanout error for event ${eventId}:`, err.message);
  }

  if (succeeded) {
    console.log(`[delivery] Event ${eventId} delivered — acking`);
    msg.ack();
  } else if (deliveryCount >= natsLib.MAX_DELIVER) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('failed', eventId);
    console.warn(`[delivery] Event ${eventId} exhausted ${natsLib.MAX_DELIVER} attempts — marking failed, acking`);
    msg.ack();
  } else {
    console.log(`[delivery] Event ${eventId} failed — naking for redelivery in ${NAK_DELAY_MS / 1000}s`);
    msg.nak(NAK_DELAY_MS);
  }
}

async function startWorker() {
  if (!natsLib.isEnabled()) {
    console.log('[delivery] NATS_URL not set — worker exiting (direct fanout mode active)');
    process.exit(0);
  }

  console.log('[delivery] Starting delivery worker...');

  try {
    const nc = await natsLib.getConnection();
    const js = await natsLib.getJetStream();
    const consumer = await js.consumers.get(natsLib.STREAM_NAME, 'delivery-worker');

    console.log('[delivery] Subscribed to WEBHOOKS stream as "delivery-worker"');

    const messages = await consumer.consume();

    for await (const msg of messages) {
      await processMessage(msg);
    }
  } catch (err) {
    console.error('[delivery] Worker error:', err.message);
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
