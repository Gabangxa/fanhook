---
name: Outbox two-phase handoff
description: Why FanHook's durable outbox rows must be inserted not-yet-due, and how delivery ownership is handed between NATS and the sweeper.
---

**Rule:** When enqueueing an outbox row alongside an event at ingest, insert it with `next_attempt_at` deferred by the pending-grace window (two-phase handoff). Only make it due immediately (`arm`) after the NATS publish has definitively failed; delete it after publish success.

**Why:** An immediately-due row lets the outbox sweeper claim and deliver the event while a slow-but-successful NATS publish is still in flight → double delivery via both the sweeper and the JetStream worker. Architect review caught this; two-phase arming closed it. Crash safety is preserved: if the process dies before arming or removing, the row becomes due after the grace window and the sweeper delivers it.

**How to apply:** Any new dispatch path that enqueues an outbox row while another delivery owner might still take the event must use the deferred insert + arm-on-failure pattern. Paths that enqueue only after the other owner has already failed (e.g. redrive's NATS-failure catch branch) can enqueue as due immediately. Delivery remains at-least-once overall — duplicates are still possible in distributed failure edges (e.g. crash after successful publish but before row removal), just not from the handoff itself.

Sweep/retry/grace timings are env-tunable (`FANHOOK_OUTBOX_SWEEP_MS`, `FANHOOK_OUTBOX_RETRY_DELAY_MS`, `FANHOOK_PENDING_GRACE_MS`); the dev workflow command sets them short so the test suites exercise the outbox path quickly.
