const express = require('express');
const path = require('path');
const { fork } = require('child_process');
const natsLib = require('./lib/nats');
const outbox = require('./lib/outbox');

// Initialize DB (creates tables and seeds demo data on first run)
const db = require('./db');

const apiRouter = require('./routes/api');
const ingestRouter = require('./routes/ingest');
const stripeWebhookRouter = require('./routes/stripe-webhook');
const webRouter = require('./routes/web');
const authRouter = require('./routes/auth');
const { pruneExpiredSessions } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Stripe webhook — must use express.raw BEFORE global json middleware
// so Stripe signature verification receives the raw bytes
// ---------------------------------------------------------------------------
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

// ---------------------------------------------------------------------------
// Ingest route — must use express.raw BEFORE global json middleware
// so signature verification receives the raw bytes
// ---------------------------------------------------------------------------
app.use('/ingest', express.raw({ type: '*/*' }), ingestRouter);

// ---------------------------------------------------------------------------
// Global JSON body parser (for /api and /web routes)
// ---------------------------------------------------------------------------
app.use(express.json());

// HTML form posts (sign-in / sign-up / sign-out)
app.use(express.urlencoded({ extended: false }));

// Prune expired sessions on startup; cheap on small tables
pruneExpiredSessions();

// ---------------------------------------------------------------------------
// Route mounts
// ---------------------------------------------------------------------------
app.use('/api', apiRouter);
app.use('/', authRouter);
app.use('/', webRouter);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Delivery worker — always forked so NATS_URL need not be set at startup.
// The worker tries nats://localhost:4222 by default (or NATS_URL if set) and
// exits cleanly (code 0) when NATS is unreachable; ingest then falls back to
// direct in-process fanout automatically. Non-zero exit = crash → restart.
// ---------------------------------------------------------------------------
let deliveryWorker = null;

function spawnDeliveryWorker() {
  const workerPath = path.join(__dirname, 'workers', 'delivery.js');
  const natsTarget = process.env.NATS_URL || 'nats://localhost:4222';
  console.log(`[server] Spawning delivery worker (NATS target: ${natsTarget})`);
  deliveryWorker = fork(workerPath, [], {
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  console.log(`[server] Delivery worker spawned (pid ${deliveryWorker.pid})`);

  deliveryWorker.on('exit', (code, signal) => {
    deliveryWorker = null;
    if (code === 0) {
      // Clean exit — NATS was unavailable or worker was asked to stop.
      // Direct in-process fanout will handle delivery until NATS comes up.
      console.log('[server] Delivery worker exited cleanly (NATS unavailable or stopped) — direct fanout active');
    } else {
      // Unexpected crash — restart after a short delay
      console.warn(`[server] Delivery worker crashed (code=${code}, signal=${signal}) — restarting in 5s`);
      setTimeout(spawnDeliveryWorker, 5_000);
    }
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down`);
  outbox.stopSweeper();
  if (deliveryWorker) {
    deliveryWorker.kill('SIGTERM');
  }
  await natsLib.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FanHook listening on port ${PORT}`);
  spawnDeliveryWorker();
  // Durable outbox sweeper: delivers events NATS couldn't accept and recovers
  // events stuck in 'pending' after a crash.
  outbox.startSweeper(db);
});

module.exports = app;
