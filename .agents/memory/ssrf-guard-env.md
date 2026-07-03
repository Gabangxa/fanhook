---
name: SSRF guard env policy
description: FANHOOK_ALLOW_PRIVATE_DESTINATIONS must be 'loopback' in dev/test or 127.0.0.1 deliveries fail
---

# SSRF guard environment policy

Outbound webhook deliveries are SSRF-guarded twice: a pre-check before delivery and a
connect-time check via a policy-enforcing DNS `lookup` on the shared http/https agents
(so DNS rebinding cannot bypass it). Policy is read from
`FANHOOK_ALLOW_PRIVATE_DESTINATIONS` at call time:

- unset → block ALL private/loopback/link-local/metadata destinations
- `loopback` → allow only 127.0.0.0/8 and ::1 (dev + test setting)
- `all`/`1`/`true` → guard disabled

**Why:** dev server and both test suites deliver to targets on 127.0.0.1. Without
`loopback` in the workflow command AND at the top of any test process that runs fanout
in-process (`tests/run-core-tests.js`, `tests/run-nats-tests.js`), every delivery is
blocked and suites fail confusingly.

**How to apply:** any new workflow, script, or test process that triggers deliveries to
local targets must set `FANHOOK_ALLOW_PRIVATE_DESTINATIONS=loopback` (env var or
`process.env` before requires). Never set `all` outside throwaway local debugging.

Related invariant: `sinks.api_key` stores only `sha256$<hex>` digests. Any new code
path that creates a sink must store `hashApiKey(plaintext)` and return the plaintext
exactly once (this was missed on the signup path once — regression test TC-9.9 guards it).
