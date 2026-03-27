# FanHook

A full-stack webhook fanout and relay service. Receives a single webhook from Stripe, GitHub, or any provider, verifies its HMAC signature, and fans it out in parallel to multiple destination URLs with automatic retries.

## Architecture

Plain Node.js/Express 4 app with server-rendered HTML frontend and SQLite via `better-sqlite3`.

### Key Files
- `server.js` — Express app entry point; raw body middleware for Stripe/ingest before global JSON parser
- `db.js` — SQLite schema (sinks, routes, events, delivery_attempts) with idempotent migrations
- `routes/api.js` — Management CRUD API (Bearer auth); sinks, routes, events, billing
- `routes/ingest.js` — Webhook ingestion endpoint; signature verification + fanout trigger
- `routes/stripe-webhook.js` — Stripe billing webhooks (subscription events)
- `routes/web.js` — Server-rendered HTML pages (home, dashboard, docs)
- `lib/fanout.js` — Parallel delivery to all routes with exponential retry logic
- `lib/verify.js` — HMAC signature verification for Stripe and GitHub
- `lib/metering.js` — Monthly event counting and tier limits
- `public/style.css` — Creative dark theme with glassmorphism, gradient accents, animations, Inter/JetBrains Mono fonts

### Data Model
- **Sinks** — a webhook receiver (has an API key, provider type, optional HMAC secret)
- **Routes** — destination URLs belonging to a sink
- **Events** — incoming webhook payloads stored per-sink
- **Delivery Attempts** — per-route delivery records with HTTP status and retry count

## Demo
- Demo API key: `demo_key_abc123` for sink `demo_sink_1`
- Ingest URL format: `POST /ingest/:sinkId`
- Management API: `GET/POST /api/sinks`, `POST/DELETE /api/sinks/:id/routes`, `GET /api/sinks/:id/events`

## Running
```
node server.js
```
Listens on port 3000. SQLite DB stored at `fanhook.db` in project root.

## Dependencies
- `express` ^4.18.2
- `better-sqlite3` ^9.4.3
- `uuid` ^9.0.0
- `node-fetch` ^3.3.2
- `stripe` ^14.0.0
