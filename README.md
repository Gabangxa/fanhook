# FanHook

A webhook fanout and relay service. Send one incoming webhook to a single endpoint ("sink") and FanHook delivers it in parallel to as many destination URLs ("routes") as you configure — with signature verification, automatic retries, and an event dashboard.

## What It Does

When you integrate with a platform like Stripe or GitHub, you get one webhook URL to configure. FanHook sits in between: it receives the webhook, verifies the signature, and fans it out in parallel to all your downstream services. Useful for:

- Routing a single Stripe event to multiple services (billing, CRM, analytics)
- Duplicating GitHub webhook events across internal tooling
- Decoupling webhook producers from consumers

## Stack

- **Runtime:** Node.js
- **Framework:** Express 4.18.2
- **Database:** SQLite via better-sqlite3 9.4.3
- **HTTP client:** node-fetch 3.3.2
- **Other:** uuid 9.0.0
- **Port:** 3000 (override with `PORT` env var)

## Getting Started

```bash
git clone https://github.com/Gabangxa/fanhook.git
cd fanhook
npm install
node server.js
```

Server runs at `http://localhost:3000`. Visit `/dashboard` to manage sinks and routes, or `/docs` for the API reference.

On first run the database is seeded with a demo Stripe sink, two routes, and sample events so you can explore the dashboard immediately.

## Core Concepts

- **Sink** — the inbound endpoint that receives a webhook from an external provider (Stripe, GitHub, or generic)
- **Route** — a destination URL that FanHook forwards the webhook payload to
- **Event** — a record of each received webhook, including delivery status per route

## Authentication

Two separate mechanisms depending on which part of the API you're using.

### Management API — Bearer Token

Creating sinks and managing routes requires a Bearer token in the `Authorization` header. Each sink is issued its own UUID API key on creation.

```
Authorization: Bearer <your-api-key>
```

### Ingest Endpoint — Signature Verification

The `/ingest/:sinkId` endpoint is public (no bearer token). Instead, it verifies the webhook signature per provider:

| Provider | Header | Method |
|---|---|---|
| `stripe` | `stripe-signature` | HMAC-SHA256 with timing-safe comparison |
| `github` | `x-hub-signature-256` | HMAC-SHA256 with timing-safe comparison |
| `generic` | — | No verification |

## Endpoints

### Management API (Bearer token required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/sinks` | Create a new sink |
| `GET` | `/api/sinks` | List all sinks for the authenticated key |
| `GET` | `/api/sinks/:sinkId/events` | Get the last 50 events with delivery details |
| `POST` | `/api/sinks/:sinkId/routes` | Add a destination URL to a sink |
| `DELETE` | `/api/sinks/:sinkId/routes/:routeId` | Remove a route from a sink |

### Ingestion (public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest/:sinkId` | Receive a webhook and trigger fanout |

### Web / Utility

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Landing page |
| `GET` | `/dashboard` | Sink, route, and event management UI |
| `GET` | `/docs` | HTML API reference |
| `GET` | `/openapi.json` | OpenAPI 3.0.3 spec |
| `GET` | `/health` | Health check with timestamp |

### Example: Create a Sink

```bash
# Create a Stripe sink
curl -X POST http://localhost:3000/api/sinks \
  -H "Content-Type: application/json" \
  -d '{"name": "My Stripe Sink", "provider": "stripe"}'

# Response includes your api_key — save it
```

### Example: Add Routes

```bash
curl -X POST http://localhost:3000/api/sinks/<sinkId>/routes \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-service.com/webhook"}'
```

### Example: Send a Webhook

Point your Stripe (or GitHub) webhook at:

```
POST http://localhost:3000/ingest/<sinkId>
```

FanHook responds immediately with `200 OK` and fans out to all configured routes in the background.

## Fanout & Retry Logic

All routes receive the payload in parallel. Each route gets up to **3 delivery attempts**:

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 120 seconds |

A `2xx` response marks the route delivery as succeeded. If at least one route succeeds the event is marked `delivered`; otherwise `failed`. Fanout is fire-and-forget — the webhook sender always gets an immediate `200`.

## Data Models

**sinks** — `id`, `name`, `provider`, `api_key`, `created_at`

**routes** — `id`, `sink_id`, `url`, `created_at`

**events** — `id`, `sink_id`, `payload`, `status` (pending / delivered / failed), `received_at`

**delivery_attempts** — `id`, `event_id`, `route_id`, `attempted_at`, `http_status`

## Project Structure

```
fanhook/
├── server.js          # Express app entry point
├── db.js              # SQLite schema init + demo seed data
├── openapi.json       # OpenAPI 3.0.3 spec
├── package.json
├── routes/
│   ├── api.js         # Management endpoints (auth required)
│   ├── ingest.js      # Webhook ingestion endpoint
│   └── web.js         # Dashboard, docs, landing page
├── lib/
│   ├── fanout.js      # Parallel delivery + retry logic
│   └── verify.js      # HMAC-SHA256 signature verification
└── public/            # Static CSS assets
```

## Deployment

Import the repository into [Replit](https://replit.com) for one-click cloud hosting — the `.replit` config is already included.

## Current Limitations

- **Retry state is in-process** — retries use `setTimeout` internally; a server restart will lose pending retry attempts.
- **SQLite only** — not suitable for horizontal scaling across multiple instances.
- **Signature secrets are demo values** — replace with real provider secrets before using in production.
- **Generic provider skips all verification** — any request will be accepted and fanned out.
- **No rate limiting** and no webhook secret rotation.

## License

MIT
