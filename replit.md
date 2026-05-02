# FanHook

A full-stack webhook fanout and relay service. Receives a single webhook from Stripe, GitHub, or any provider, verifies its HMAC signature, and fans it out in parallel to multiple destination URLs with automatic retries.

## Architecture

Plain Node.js/Express 4 app with server-rendered HTML frontend and SQLite via `better-sqlite3`.

When `NATS_URL` is set, FanHook uses NATS JetStream for durable, queue-backed delivery:
- Ingest route publishes events to the `WEBHOOKS` JetStream stream
- A forked delivery worker (`workers/delivery.js`) consumes and fans out
- JetStream handles at-least-once delivery with up to 3 redelivery attempts
- Server restarts no longer lose in-flight events

When `NATS_URL` is absent, the app falls back to the legacy in-process fire-and-forget fanout.

### Key Files
- `server.js` — Express entry point; forks delivery worker when NATS_URL is set
- `db.js` — SQLite schema (sinks, routes, events, delivery_attempts) with idempotent migrations
- `routes/api.js` — Management CRUD API (Bearer auth); sinks, routes, events, billing
- `routes/ingest.js` — Webhook ingestion; publishes to NATS or falls back to direct fanout
- `routes/stripe-webhook.js` — Stripe billing webhooks (subscription events)
- `routes/web.js` — Server-rendered HTML pages (home, dashboard, docs)
- `lib/nats.js` — NATS JetStream client singleton; stream + consumer setup
- `lib/fanout.js` — Parallel delivery to all routes with per-route retry logic
- `lib/verify.js` — HMAC signature verification for Stripe and GitHub
- `lib/metering.js` — Monthly event counting and tier limits
- `workers/delivery.js` — Durable NATS delivery worker; ack/nak with JetStream redelivery
- `public/style.css` — Creative dark theme with glassmorphism, gradient accents, Inter/JetBrains Mono fonts

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
Listens on `PORT` env var (default 3000). SQLite DB stored at `fanhook.db` in project root.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (set automatically by Replit) |
| `NATS_URL` | No | NATS server URL (e.g. `nats://localhost:4222`). When set, enables durable JetStream delivery via the forked worker. Omit to use legacy direct fanout. |
| `STRIPE_SECRET_KEY` | No* | Stripe secret key for billing |
| `STRIPE_WEBHOOK_SECRET` | No* | Stripe webhook signing secret |
| `STRIPE_STARTER_PRICE_ID` | No* | Stripe price ID for the Starter plan ($9/mo) |

*Required only for Stripe billing flows.

## Dependencies
- `express` ^4.18
- `better-sqlite3` ^9.4
- `uuid` ^9.0
- `node-fetch` ^3.3
- `stripe` ^14.0
- `nats` ^2.x — NATS JetStream client (durable delivery when NATS_URL is set)
