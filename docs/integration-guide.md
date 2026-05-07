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
| `500` | `INTERNAL_ERROR` | ✅ **Yes — same key** | Unexpected server failure. The original request may or may not have committed; the same key guarantees no double-execution on retry |
| `502/503/504` | (no body) | ✅ **Yes — same key** | Transient infra error (gateway, lambda timeout, DB blip) |

**Rule of thumb:** anything that returns 409 with `LOCK_CONTENDED` /
`VERSION_CONFLICT` / `IDEMPOTENCY_KEY_IN_PROGRESS`, plus all 5xx, is
retryable **provided you reuse the same `Idempotency-Key`**. Everything
else (4xx domain or validation errors) is permanent for the given
request and retrying without changes will produce the same response.

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
    const delayMs = baseDelayMs * 2 ** (attempt - 1)
                  + Math.floor(Math.random() * 100);    // exponential + jitter
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

## Concurrency model — what to expect under load

Each wallet is serialized by a per-wallet distributed lock. Concurrent
operations on the **same** wallet will see one succeed and the others
receive `409 LOCK_CONTENDED` after a short server-side wait. This is
intentional backpressure: the server fails fast instead of queueing
clients indefinitely. Reusing the same `Idempotency-Key` on the retry
guarantees no double-spend even when the server is busy.

Operations on **different** wallets do not block each other.

## Health and status

- `GET /health` — returns `200` with `{ "status": "ok", "db":
  "connected" }` when the service is healthy. Returns `503` with
  `"degraded"` when the database is unreachable. Use this for load
  balancer probes; do **not** poll it as a signal of API
  responsiveness — the path bypasses business logic.
