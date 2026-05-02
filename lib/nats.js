/**
 * lib/nats.js
 *
 * NATS JetStream client singleton for FanHook.
 *
 * When NATS_URL is set the app uses durable JetStream delivery.
 * When NATS_URL is absent the helpers return null so callers can fall back
 * to the legacy in-process fanout.
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

const jc = JSONCodec();

let nc = null;
let js = null;

function isEnabled() {
  return !!process.env.NATS_URL;
}

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

async function getConnection() {
  if (nc) return nc;

  const url = process.env.NATS_URL || 'nats://localhost:4222';
  nc = await connect({ servers: url });
  console.log(`[nats] Connected to ${url}`);

  const jsm = await nc.jetstreamManager();
  await setupStream(jsm);
  await setupConsumer(jsm);

  js = nc.jetstream();
  return nc;
}

async function getJetStream() {
  await getConnection();
  return js;
}

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
    console.log('[nats] Disconnected');
  }
}

module.exports = {
  isEnabled,
  getConnection,
  getJetStream,
  publish,
  disconnect,
  jc,
  STREAM_NAME,
  SUBJECT_PREFIX,
  MAX_DELIVER,
};
