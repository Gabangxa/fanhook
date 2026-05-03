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
- `lib/verify.js` — HMAC signature verification for Stripe, GitHub, Shopify, Linear, PagerDuty (v3), and Clerk (Svix); per-provider landing pages live at `/providers/:slug` (see `routes/web.js` `PROVIDER_PAGES`).
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

## Testing

Core functionality test suite (Groups 1–7 + Group 9 UI smoke; Stripe excluded):

```bash
npm run test:core
```

The Node runner (`tests/run-core-tests.js`) talks to the live server on `PORT` (default 3000), spins up an in-process HTTP target on a random port to act as a webhook destination, and reaches into the SQLite DB directly for fixture seeding/verification. Fixtures are tagged with the `tc-` name prefix and cleaned before/after each run. Group 9 UI checks were run via the testing skill (Playwright). Full results: `tests/CORE_TEST_RESULTS.md`.

The `Start application` workflow runs with `FANHOOK_RETRY_DELAYS_MS=0,100,100` so retry-related tests finish in seconds. In production this env var is unset and `lib/fanout.js` falls back to its default `[0, 30s, 120s]` schedule.

NATS + delivery-worker integration suite (requires `nats-server` on PATH; the runner spawns its own ephemeral JetStream server on a random port — no manual setup needed):

```bash
npm run test:nats
```

`tests/run-nats-tests.js` covers Group N (lib/nats.js: connect, stream/consumer setup, publish, publishToDLQ, listDLQMessages, deleteDLQMessage, publishStatusEvent) and Group W (workers/delivery.js processMessage cascade: success, no-routes-DLQ, transient-NAK, max-deliver-DLQ, already-delivered short-circuit, missing-event ack-to-discard). Each test has an 8s hard timeout to surface hangs as failures rather than blocking the suite.

This suite revealed and fixed a defect in `lib/nats.js#listDLQMessages`: the OrderedConsumer `fetch()`/`consume()` path hangs indefinitely on nats-server 2.10 + nats.js 2.29. It now uses an ephemeral durable pull consumer (AckPolicy.None, filter_subject) which is deleted in the `finally` block — same external semantics, but reliable.

Other endpoints/behaviors added or fixed for the suite:
- `GET/POST /dashboard/api/sinks` — session-authed, per-user sink list and create (used by the dashboard UI; `/api/sinks` remains api-key-scoped). The POST is CSRF-protected via `auth.requireCsrf` and accepts the token in either an `X-CSRF-Token` header or a `_csrf` body field.
- `requireAuth` accepts `Authorization: Bearer <key>` OR `X-Api-Key: <key>`.
- `POST /api/sinks/:sinkId/routes` enforces tier route caps (Free=3, Starter=10) returning 403.
- `requireSinkAuth` returns 401 (not 403) for cross-tenant API key usage.
- Missing/malformed signature header on ingest → 400; cryptographic mismatch → 401.

## Dependencies
- `express` ^4.18
- `better-sqlite3` ^9.4
- `uuid` ^9.0
- `node-fetch` ^3.3
- `stripe` ^14.0
- `nats` ^2.x — NATS JetStream client (durable delivery when NATS_URL is set)
