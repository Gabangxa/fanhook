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

// DLQ stream constants
const DLQ_STREAM_NAME = 'DLQ';
const DLQ_SUBJECT_PREFIX = 'webhook.dlq';
const DLQ_MAX_AGE_DAYS = 7;
const DLQ_MAX_MSGS_PER_SUBJECT = 500;

const jc = JSONCodec();

let nc = null;
let js = null;
// Promise shared across concurrent callers during the initial connect
let connectingPromise = null;

// Worst-case fanout: 3 routes × (0s + 30s + 120s) in-process retries ≈ 150 s.
// Set ack_wait well above that so JetStream does not redeliver while fanout
// is still running. The worker also calls msg.working() every 20 s as a belt-
// and-suspenders safeguard.
const ACK_WAIT_MS = 5 * 60 * 1000; // 5 minutes

async function setupStream(jsm) {
  // max_deliver and ack_wait are consumer-level settings — not included here.
  const config = {
    name: STREAM_NAME,
    subjects: [`${SUBJECT_PREFIX}.*`],
    retention: RetentionPolicy.Workqueue,
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

async function setupDLQStream(jsm) {
  const config = {
    name: DLQ_STREAM_NAME,
    subjects: [`${DLQ_SUBJECT_PREFIX}.*`],
    retention: RetentionPolicy.Limits,
    max_age: nanos(DLQ_MAX_AGE_DAYS * 24 * 60 * 60 * 1000),
    max_msgs_per_subject: DLQ_MAX_MSGS_PER_SUBJECT,
  };

  try {
    await jsm.streams.add(config);
    console.log(`[nats] Stream "${DLQ_STREAM_NAME}" created`);
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('stream name already in use') || msg.includes('already exists')) {
      console.log(`[nats] Stream "${DLQ_STREAM_NAME}" already exists`);
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
      ack_wait: nanos(ACK_WAIT_MS),
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
  await setupDLQStream(jsm);
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

/**
 * Publish a failed event to the DLQ JetStream stream.
 * Returns the PubAck (contains .seq — the NATS stream sequence number).
 * Best-effort — callers should swallow errors so DLQ failures don't block acks.
 *
 * @param {string} sinkId
 * @param {object} data - { event_id, sink_id, payload (b64), headers, failed_at, attempt_count, failure_reason }
 * @returns {Promise<import('nats').PubAck>}
 */
async function publishToDLQ(sinkId, data) {
  const jetstream = await getJetStream();
  const subject = `${DLQ_SUBJECT_PREFIX}.${sinkId}`;
  const pubAck = await jetstream.publish(subject, jc.encode(data));
  return pubAck;
}

/**
 * List the last `limit` DLQ messages for a sink using an ephemeral pull consumer.
 * Creates a temporary durable consumer, fetches messages, deletes the consumer.
 * Returns messages ordered most-recent-first, each with a `_nats_seq` field.
 *
 * @param {string} sinkId
 * @param {number} [limit=50]
 * @returns {Promise<Array<object>>}
 */
async function listDLQMessages(sinkId, limit = 50) {
  const js = await getJetStream();
  const nc = await getConnection();
  const jsm = await nc.jetstreamManager();
  const subject = `${DLQ_SUBJECT_PREFIX}.${sinkId}`;

  // Create an ephemeral consumer (no durable_name = ordered consumer semantics)
  // with DeliverPolicy.All and a per-subject filter. Using DeliverPolicy.All is
  // correct for multi-tenant streams: the subject filter is enforced server-side,
  // so we only receive messages for this sink regardless of how many other sinks
  // have messages in the stream. The DLQ stream is bounded to 500 msgs/subject
  // (LimitsPolicy max_msgs_per_subject), so fetching all is always O(1) bounded.
  let ephemeralName;
  try {
    const consumerInfo = await jsm.consumers.add(DLQ_STREAM_NAME, {
      // No durable_name → ephemeral consumer (ordered consumer semantics)
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: subject,
    });
    ephemeralName = consumerInfo.name; // Server assigns a random name for ephemeral consumers
  } catch (_) {
    return [];
  }

  try {
    const consumer = await js.consumers.get(DLQ_STREAM_NAME, ephemeralName);
    const msgs = [];

    try {
      // Fetch up to the per-subject cap (500). Not acking — LimitsPolicy retains
      // messages regardless of ack state; consumer is deleted immediately after use.
      const iter = await consumer.fetch({ max_messages: 500, expires: 2000 });
      for await (const msg of iter) {
        const data = jc.decode(msg.data);
        msgs.push({
          ...data,
          _nats_seq: msg.info ? msg.info.streamSequence : null,
        });
      }
    } catch (_) {
      // Timeout is expected when the subject has fewer messages than the fetch cap
    }

    // msgs is oldest-first; return the most recent `limit` entries, newest-first
    return msgs.slice(-limit).reverse();
  } finally {
    if (ephemeralName) {
      try { await jsm.consumers.delete(DLQ_STREAM_NAME, ephemeralName); } catch (_) {}
    }
  }
}

/**
 * Delete a specific message from the DLQ stream by its stream sequence number.
 *
 * @param {number} seq - NATS stream sequence number from msg.info.streamSequence
 */
async function deleteDLQMessage(seq) {
  const nc = await getConnection();
  const jsm = await nc.jetstreamManager();
  await jsm.streams.deleteMessage(DLQ_STREAM_NAME, seq);
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
  publishToDLQ,
  listDLQMessages,
  deleteDLQMessage,
  disconnect,
  jc,
  NATS_URL,
  STREAM_NAME,
  SUBJECT_PREFIX,
  DLQ_STREAM_NAME,
  DLQ_SUBJECT_PREFIX,
  MAX_DELIVER,
};
