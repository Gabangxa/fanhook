const express = require('express');
const path = require('path');

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
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FanHook listening on port ${PORT}`);
});

module.exports = app;
