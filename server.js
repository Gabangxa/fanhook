const express = require('express');
const path = require('path');
const { fork } = require('child_process');
const natsLib = require('./lib/nats');

// Initialize DB (creates tables and seeds demo data on first run)
const db = require('./db');

const apiRouter = require('./routes/api');
const ingestRouter = require('./routes/ingest');
const stripeWebhookRouter = require('./routes/stripe-webhook');
const webRouter = require('./routes/web');

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

// ---------------------------------------------------------------------------
// Route mounts
// ---------------------------------------------------------------------------
app.use('/api', apiRouter);
app.use('/', webRouter);

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Delivery worker — forked as a child process when NATS_URL is set
// ---------------------------------------------------------------------------
let deliveryWorker = null;

function spawnDeliveryWorker() {
  if (!natsLib.isEnabled()) {
    console.log('[server] NATS_URL not set — using direct in-process fanout');
    return;
  }

  const workerPath = path.join(__dirname, 'workers', 'delivery.js');
  deliveryWorker = fork(workerPath, [], {
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  console.log(`[server] Delivery worker spawned (pid ${deliveryWorker.pid})`);

  deliveryWorker.on('exit', (code, signal) => {
    console.warn(`[server] Delivery worker exited (code=${code}, signal=${signal}) — restarting in 5s`);
    deliveryWorker = null;
    setTimeout(spawnDeliveryWorker, 5_000);
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down`);
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
});

module.exports = app;
