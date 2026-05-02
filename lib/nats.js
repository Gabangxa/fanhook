/**
 * lib/nats.js
 *
 * NATS JetStream client singleton for FanHook.
 *
 * Always attempts to connect to NATS_URL (defaults to nats://localhost:4222).
 * Callers that catch a publish error should fall back to direct in-process fanout.
 */

const {
  connect,
  RetentionPolicy,
  AckPolicy,
  DeliverPolicy,
  nanos,
  JSONCodec,
} = require('nats');

const STREAM_NAME = 'WEBHOOKS';
const SUBJECT_PREFIX = 'webhook.ingest';
const MAX_DELIVER = 3;
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

const jc = JSONCodec();

let nc = null;
let js = null;
// Promise shared across concurrent callers during the initial connect
let connectingPromise = null;

async function setupStream(jsm) {
  const config = {
    name: STREAM_NAME,
    subjects: [`${SUBJECT_PREFIX}.*`],
    retention: RetentionPolicy.Workqueue,
    max_deliver: MAX_DELIVER,
    ack_wait: nanos(30_000),
  };

  try {
    await jsm.streams.add(config);
    console.log(`[nats] Stream "${STREAM_NAME}" created`);
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('stream name already in use') || msg.includes('already exists')) {
      console.log(`[nats] Stream "${STREAM_NAME}" already exists`);
    } else {
      throw err;
    }
  }
}

async function setupConsumer(jsm) {
  try {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: 'delivery-worker',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: MAX_DELIVER,
      ack_wait: nanos(30_000),
    });
    console.log('[nats] Consumer "delivery-worker" created');
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('consumer name already in use') || msg.includes('already exists')) {
      console.log('[nats] Consumer "delivery-worker" already exists');
    } else {
      throw err;
    }
  }
}

async function _doConnect() {
  nc = await connect({
    servers: NATS_URL,
    // Fail fast if the server is not reachable on the first attempt
    reconnect: false,
  });
  console.log(`[nats] Connected to ${NATS_URL}`);

  const jsm = await nc.jetstreamManager();
  await setupStream(jsm);
  await setupConsumer(jsm);

  js = nc.jetstream();
  return nc;
}

async function getConnection() {
  if (nc) return nc;

  // Coalesce concurrent connect calls into a single attempt
  if (!connectingPromise) {
    connectingPromise = _doConnect().catch((err) => {
      // Reset so a future call can retry (e.g. after the server comes up)
      connectingPromise = null;
      nc = null;
      js = null;
      throw err;
    });
  }

  return connectingPromise;
}

async function getJetStream() {
  await getConnection();
  return js;
}

/**
 * Publish a webhook delivery job to NATS JetStream.
 *
 * @param {string} sinkId
 * @param {object} data - must include: eventId, sinkId, rawBodyB64, headers
 */
async function publish(sinkId, data) {
  const jetstream = await getJetStream();
  const subject = `${SUBJECT_PREFIX}.${sinkId}`;
  await jetstream.publish(subject, jc.encode(data));
}

async function disconnect() {
  if (nc) {
    try {
      await nc.drain();
    } catch (_) {}
    nc = null;
    js = null;
    connectingPromise = null;
    console.log('[nats] Disconnected');
  }
}

module.exports = {
  getConnection,
  getJetStream,
  publish,
  disconnect,
  jc,
  NATS_URL,
  STREAM_NAME,
  SUBJECT_PREFIX,
  MAX_DELIVER,
};
