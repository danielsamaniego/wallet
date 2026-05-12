# Integration Guide

Guidance for platforms integrating against the Wallet Service API. The
interactive reference at `/docs` (Scalar UI) is generated from the
OpenAPI spec; this document covers cross-cutting behaviour the spec
alone cannot fully express — idempotency contract, retry strategy, and
how to interpret each error code under load.

## Authentication

Every request requires an `X-API-Key` header containing the platform's
API key (format: `<api_key_id>.<secret>`). API keys are scoped to a
single platform and cannot read or modify wallets owned by another
platform. Missing or invalid keys return `401`.

## Idempotency

**Every mutating request (POST, PATCH, DELETE) MUST include an
`Idempotency-Key` header.** A UUIDv4/v7 or any client-generated unique
string works. The server uses it to guarantee that a deposit, transfer,
hold, or other write is applied **at most once**, even if the client
retries.

**Contract:**

- First request with key `K`: handler executes, response is cached.
- Repeat with key `K` and **same body**: server replays the cached
  response without re-executing the handler.
- Repeat with key `K` and **different body**: `422
  IDEMPOTENCY_PAYLOAD_MISMATCH`. Generate a new key for the new payload.
- Repeat with key `K` while the original is still in flight: `409
  IDEMPOTENCY_KEY_IN_PROGRESS`. Wait and retry with the same key.

Keys are cached for **48 hours**. Reusing a key after the TTL is treated
as a new request.

**One key per logical operation.** Generating a fresh key per HTTP retry
defeats the purpose — the server cannot tell two retries from two
distinct deposits, and you risk double-charging on transient failures.

**Persist the key before sending the request.** Generating it inside
the call site means a client crash between "request sent" and "response
received" loses the key — the operation may have committed on the
server but you have no way to recover the result without potentially
double-charging on the next attempt. Persist (DB row, queue, log line)
the `Idempotency-Key` together with whatever business state you need
to track the operation, **then** send the request. If the client dies,
the next process run reads the persisted key and retries with it
safely.

**Log the Idempotency-Key alongside every business event** in your
own systems. Support investigations almost always start with "what
happened to operation X" and the Idempotency-Key is the unique handle
that lets the wallet team trace the request end-to-end in our logs.

## Error response shape

All errors return JSON in this shape:

```json
{ "error": "UPPER_SNAKE_CASE_CODE", "message": "human-readable description" }
```

The `error` field is stable across versions and intended for
machine-driven branching. The `message` is for humans.

## Error codes and retry policy

| Status | Code | Retryable? | What it means |
|---|---|---|---|
| `400` | `MISSING_IDEMPOTENCY_KEY` | ❌ No | Add the `Idempotency-Key` header |
| `400` | `VALIDATION_ERROR` | ❌ No | Body or query params failed validation. Fix the payload before retrying |
| `401` | `MISSING_API_KEY` / `INVALID_API_KEY` | ❌ No | Auth problem; do not retry until keys are corrected |
| `403` | `FORBIDDEN_*` | ❌ No | Cross-tenant access or permission denied |
| `404` | `NOT_FOUND` / `WALLET_NOT_FOUND` / `HOLD_NOT_FOUND` | ❌ No | Resource does not exist for this platform |
| `409` | **`LOCK_CONTENDED`** | ✅ **Yes — same key** | Another request is currently mutating this wallet. The server's per-wallet distributed lock rejected this attempt to fail fast instead of queueing. Retry with **the same `Idempotency-Key`**, after a short backoff |
| `409` | **`VERSION_CONFLICT`** | ✅ **Yes — same key** | Optimistic locking detected a concurrent write. The DB serialization retries inside the server were exhausted. Retry with the same key |
| `409` | `IDEMPOTENCY_KEY_IN_PROGRESS` | ✅ **Yes — same key** | A previous request with this key is still running. Wait briefly and retry |
| `409` | `WALLET_FROZEN` / `WALLET_CLOSED` / `HOLD_ALREADY_CAPTURED` / `HOLD_EXPIRED` / `HOLD_VOIDED` | ❌ No | Domain rule violation; retrying will produce the same result. Resolve the underlying state instead |
| `413` | `PAYLOAD_TOO_LARGE` | ❌ No | Body exceeds 64 KB. Reduce payload |
| `422` | `IDEMPOTENCY_PAYLOAD_MISMATCH` | ❌ No | Same key was used with a different body. Generate a new key |
| `422` | `INSUFFICIENT_FUNDS` / `INVALID_AMOUNT` / `CURRENCY_MISMATCH` | ❌ No | Domain rule violation |
| `429` | `RATE_LIMIT_EXCEEDED` | ✅ Yes | Honour `Retry-After` if present, otherwise back off |
| `500` | `INTERNAL_ERROR` | ✅ **Yes — same key** | Unexpected server bug. Rare. The original request may or may not have committed; the same key guarantees no double-execution on retry |
| **`503`** | **`SERVICE_UNAVAILABLE`** | ✅ **Yes — same key** | **Transient infra saturation (DB pool exhausted, engine error, network blip). Server signals this explicitly. Honour `Retry-After` header (seconds).** |
| `502/504` | (no body) | ✅ **Yes — same key** | Transient gateway / lambda timeout |

**Rule of thumb:** anything that returns 409 with `LOCK_CONTENDED` /
`VERSION_CONFLICT` / `IDEMPOTENCY_KEY_IN_PROGRESS`, plus all 5xx, is
retryable **provided you reuse the same `Idempotency-Key`**. Everything
else (4xx domain or validation errors) is permanent for the given
request and retrying without changes will produce the same response.

**503 vs 500:** when the server can identify the failure as transient
infrastructure (pool exhausted, query timeout, etc.) it returns **503
SERVICE_UNAVAILABLE with a `Retry-After` header**. 500 INTERNAL_ERROR is
reserved for genuinely unexpected bugs. Both are retryable, but 503 is
the explicit "this WILL succeed when retried in a moment" signal —
honour the `Retry-After` (in seconds) when present.

## Handling uncertain failures (the central guarantee)

When you receive a `5xx`, a network error, or your HTTP client times
out, **you don't know whether the operation committed on the server**.
The wire was cut after the server received the request but before you
saw the response. Three cases are possible:

1. The server received the request and committed it; the response was
   lost in transit.
2. The server received the request and the handler errored mid-way
   (transaction rolled back; nothing committed).
3. The server never received the request.

You cannot distinguish these from the client side. **You also do not
need to.** The contract of the API is:

> Retrying the same request with the same `Idempotency-Key` is **always
> safe**. If the operation committed on a previous attempt, the server
> will replay the cached response. If it did not commit, the retry will
> execute it. Either way, the operation runs **exactly once**.

This is why generating a fresh key per attempt is dangerous — it forces
the server to treat the retry as a new operation and you risk
double-execution. Generate the key **once per logical operation**, persist
it before sending, and reuse it across every retry.

## Client timeout configuration

The server caps each request at **`maxDuration: 55s`** (Vercel
serverless). Set your HTTP client timeout to **at least 60 s** —
ideally 65–90 s — so you never abandon a request that the server is
still processing. Aborting the client connection at 30 s does not
cancel the server-side work; the request continues to completion and
the next retry (with the same `Idempotency-Key`) will replay the
result.

| Layer | Recommended timeout |
|---|---|
| HTTP client per-request | **60–90 s** (≥ server `maxDuration`) |
| Per-attempt application logic | 60–90 s |
| Total budget across retries | tune to your SLO; 5 client attempts ≈ 6 s of client-side backoff + 5 × per-request. Each per-request may take up to ~7–10 s under heavy contention because the server retries internally up to 15 times (~5.93 s worst-case sleep budget) before surfacing `409 VERSION_CONFLICT`. |

If you must cap clients tighter than 60 s for SLO reasons, accept
that tail-latency requests will look like timeouts to your client; the
retry-with-same-key logic still recovers correctness.

## Recommended retry strategy

```ts
// Pseudo-code; adapt to your HTTP client.
async function callWalletApi(
  method: string,
  path: string,
  body: object | undefined,
): Promise<Response> {
  const idempotencyKey = crypto.randomUUID();          // ← generated ONCE
  const baseDelayMs = 200;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,             // ← SAME key every retry
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status < 500 && res.status !== 409) return res;     // 2xx/3xx/4xx (non-409): final
    if (res.status === 409) {
      const { error } = await res.clone().json().catch(() => ({}));
      if (error !== "LOCK_CONTENDED" && error !== "VERSION_CONFLICT" &&
          error !== "IDEMPOTENCY_KEY_IN_PROGRESS") {
        return res;                                           // other 409: domain, do not retry
      }
    }

    if (attempt === maxAttempts) return res;

    // Honour Retry-After when the server suggests one (typical on 503).
    const retryAfter = Number(res.headers.get("Retry-After"));
    const baseDelay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** (attempt - 1);
    const delayMs = baseDelay + Math.floor(Math.random() * 100);    // + jitter
    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error("unreachable");
}
```

**Recommended parameters:**

- **Base delay:** 200 ms with full jitter
- **Max attempts:** 5 (≈ 6 s of cumulative backoff in the worst case)
- **Total budget:** keep it under your client's request timeout; the
  server caps each request at ~55 s

## Sustained overload — what to do after retries are exhausted

The 5-attempt loop above handles transient contention (a few hundred
milliseconds to a couple of seconds). It does **not** help when the
service is degraded for minutes — the DB is saturated, the lambda is
queue-throttled, etc. After exhausting retries you have these options,
in order of preference:

1. **Persist the operation as "pending" with its `Idempotency-Key`**
   and surface it to a background worker that retries asynchronously
   with longer backoffs (minutes). The key guarantees that even if the
   original attempt eventually committed, the worker's retry replays
   the cached response instead of double-executing.
2. **Trip a circuit breaker** at your client side once the failure rate
   over a recent window crosses a threshold. While the breaker is
   open, fail fast at your edge instead of forwarding traffic that has
   no chance of succeeding — this protects the wallet service from
   thundering-herd retries that prolong the outage.
3. **Page on-call** when pending operations exceed an SLO threshold.
   Per-operation retries cannot fix a sustained outage; humans need to
   know.

**Don't:** raise per-attempt timeouts or attempt counts to "wait it
out". You compound the load problem and tie up your own resources.
Fail fast, persist, retry asynchronously.

### Distinguishing transient blip from sustained outage

| Signal | Likely cause | Action |
|---|---|---|
| Single 5xx, then 200 on retry 1-2 | Cold start / blip | Default loop handles it |
| `429 RATE_LIMIT_EXCEEDED` with `Retry-After` | Wallet service rate limit | Honour `Retry-After` |
| Repeated `409 LOCK_CONTENDED` on the **same wallet** | Wallet is hot — a long-running operation has it | Continue retrying; per-wallet contention resolves |
| Repeated 5xx across **different wallets** for >30 s | Service degradation | Trip circuit breaker, queue async |
| `503` on `/health` | Database unreachable | Stop retrying, alert; exponential client-side backoff |

## Concurrency model — what to expect under load

Each wallet is serialized by a per-wallet distributed lock. Concurrent
operations on the **same** wallet will see one succeed and the others
receive `409 LOCK_CONTENDED` after a short server-side wait. This is
intentional backpressure: the server fails fast instead of queueing
clients indefinitely. Reusing the same `Idempotency-Key` on the retry
guarantees no double-spend even when the server is busy.

Operations on **different** wallets do not block each other.

## Holds and expiration

Holds (authorization-style reservations) carry an `expires_at`
timestamp. The server runs an expiry job every minute that voids
expired holds and releases the reserved balance. Practical
implications for clients:

- **A capture against an expired hold returns `409 HOLD_EXPIRED`.**
  This is **not** retryable — the hold is gone. The client must place
  a fresh hold (with a new `Idempotency-Key`) if it still needs the
  authorization.
- **Set `expires_at` long enough** to absorb the full
  authorize→capture window plus client retries. Holds shorter than 60
  seconds are risky because a single round of server-side timeouts
  plus client retries can consume that budget.
- **Voiding an already-expired hold** is a no-op (returns success).
  Safe to call even if you're not sure of the current state.
- **Capturing an already-captured hold** returns `409
  HOLD_ALREADY_CAPTURED` — domain rule, not retryable.

## Health and status

- `GET /health` — returns `200` with `{ "status": "ok", "db":
  "connected" }` when the service is healthy. Returns `503` with
  `"degraded"` when the database is unreachable. Use this for load
  balancer probes; do **not** poll it as a signal of API
  responsiveness — the path bypasses business logic.
