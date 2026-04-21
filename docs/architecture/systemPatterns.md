# System Patterns — Wallet Service

Architecture patterns and technical decisions for the Wallet Service.

## Backend

**DDD + Hexagonal (Ports & Adapters) + CQRS** — **without Event Sourcing or Event-Driven** patterns. Coordination between bounded contexts is synchronous (direct function calls, no message bus).

- **Dependency rule**: Domain and app must **not** import from adapters or HTTP. They depend only on interfaces (ports) and `utils/kernel/` packages. Never import from `utils/infrastructure/` or `utils/middleware/` in domain or app — that's an architecture violation. Third-party libs (Prisma, Pino, uuidv7, Hono) live only in adapters.
- **ID generation — UUID v7 only, from application**: `IIDGenerator` interface; implementation uses `uuidv7`. App generates all IDs; DB never generates them (no `DEFAULT gen_random_uuid()`).
- **Amounts**: Integer values in smallest currency unit per ISO 4217 (`bigint` / BigInt) everywhere. Column names use `_minor` as convention; the actual unit depends on the currency's minor unit exponent (2 for USD/EUR, 0 for CLP, 3 for KWD). Supported currencies: USD, EUR, MXN, CLP, KWD. No floating point.
- **Timestamps**: Unix milliseconds (ms since epoch) everywhere: DB (BigInt), domain, ports, DTOs, API.
- **Commands**: Write side; mutate aggregates via domain repositories (interface). May return minimal data (e.g. created ID) — see backend-architecture.md for rationale. Dispatched via `ICommandBus`.
- **Queries**: Read side; return DTOs via ReadStore (interface); no aggregate loading for display. Dispatched via `IQueryBus`.
- **No Event Sourcing**: The immutable `ledger_entries` table provides the audit trail that Event Sourcing would offer. Direct state persistence with `cached_balance_minor` gives O(1) reads without event replay. See backend-architecture.md § "No Event Sourcing — and why" for full rationale.
- **No Event-Driven**: BCs communicate synchronously within the same process. No message bus, no eventual consistency.
- **Driving/inbound adapters**: HTTP (Hono route files in `wallet/infrastructure/adapters/inbound/http/`) and scheduled jobs (in `wallet/infrastructure/adapters/inbound/scheduler/` and `common/idempotency/infrastructure/adapters/inbound/scheduler/`).
- **Outgoing/outbound adapters**: PostgreSQL (Prisma) in `wallet/infrastructure/adapters/outbound/prisma/`.
- **Outbound port convention**: All outbound port methods (repositories, read stores, transaction manager) receive `ctx: AppContext` as their first parameter. Adapters typically receive `ILogger` in their constructor for traceability. Exception: adapters like `PrismaIdempotencyStore` may receive `IIDGenerator` instead when their responsibility is record creation rather than domain persistence — the adapter's constructor signature depends on its needs, not a rigid rule.

See **[backend-architecture.md](backend-architecture.md)** for full directory layout, bounded contexts, and handler rules.

## TransactionManager (not Unit of Work)

Command handlers use a `TransactionManager` port to execute multiple repository writes atomically. This is a **pragmatic alternative to the Unit of Work pattern**, not a UoW implementation:

| Aspect | Unit of Work (Fowler) | TransactionManager (ours) |
|---|---|---|
| Change tracking | Automatic — UoW detects dirty entities | None — handler calls `save()` explicitly |
| Identity map | Yes — one instance per entity per transaction | No — same entity could be loaded twice |
| Automatic flush | Yes — `commit()` persists all tracked changes | No — each `save()` is explicit |
| Atomicity | Yes | Yes (via Prisma `$transaction`) |

**Why not a full UoW?** A real Unit of Work requires change tracking and an identity map, which adds significant complexity for marginal benefit in our case. Our handlers are short, explicit, and easy to reason about: load → mutate → save. The `TransactionManager` gives us the atomicity guarantee we need (all-or-nothing within `run()`) without the machinery of tracking entity state.

**Port**: `ITransactionManager` interface in `utils/application/transaction.manager.ts`. Its `run()` method receives the current `AppContext` and passes an enriched copy (with `opCtx` populated) to the callback.
**Repositories**: Each repository method receives a single `ctx: AppContext`. The Prisma adapter inspects `ctx.opCtx` internally — when present it uses the transaction client, otherwise the default client. This keeps the `TransactionManager` decoupled from repositories — it only opens/closes the transaction scope.
**Adapter**: `PrismaTransactionManager` (`utils/infrastructure/prisma.transaction.manager.ts`) wraps `prisma.$transaction()` with **Serializable isolation level** and spreads the original `AppContext` with `opCtx: tx` to produce the enriched context.

**When to use TransactionManager**: Use `txManager.run()` only when the use case performs **multiple writes that must be atomic** — if the operation fails mid-way, partial writes would create data inconsistency (e.g., deposit: wallet balance + transaction + ledger entries must all succeed or all fail). Use cases that perform a **single idempotent write** (e.g., `ExpireHoldsUseCase` calling `holdRepo.expireOverdue()`) or **read-only queries** do not need a transaction wrapper.

### Server-side retry (internal to TransactionManager)

The `PrismaTransactionManager` includes an **internal retry loop** (up to 5 attempts with full-jitter exponential backoff: each inter-attempt sleep is a uniform random in `[1, 30·2^(n-1)]` ms, so per-attempt ceilings are 30/60/120/240 ms) for retryable errors:

- **VERSION_CONFLICT**: Our domain-level optimistic locking error.
- **PostgreSQL serialization failure** (SQLSTATE 40001 / Prisma P2034 / `TransactionWriteConflict`): Thrown under Serializable isolation when PostgreSQL (or the Prisma 7 engine) detects a read/write or write/write dependency conflict.

If all retries are exhausted, serialization failures are escalated as `VERSION_CONFLICT` (409) so the client can retry with the same idempotency key. Non-retryable errors propagate immediately without retry.

The retry knobs are set to the industry-standard defaults (AWS backoff guidance): jitter prevents retry waves from re-colliding at the same clock tick, and 5 attempts give SSI one more chance to pick a winning serialization order than 3. Under extreme cross-wallet contention (hundreds of concurrent transactions on the same sharded `(platform, currency)`), no retry tuning saves the day — we measured deterministic 3-retry and jittered 5-retry and both land in the same band on the 300×4 load test. The right lever at that point is lowering contention at the source (more shards, smaller tx footprint); whatever survives is the client's to retry via the same `Idempotency-Key`.

## Logging

**Production goal: full traceability.** Every request must be reconstructable from logs alone — follow `tracking_id` through HTTP → app handler → adapter → DB.

Structured logging via port `ILogger` (`utils/kernel/observability/logger.port.ts`; implementation: PinoAdapter in `utils/infrastructure/observability/`). Wiring chain: **PinoAdapter → SensitiveKeysFilter** (omits configured keys, recursive through nested objects) → **SafeLogger** (logger failure never stops execution).

- **Applied across the entire backend**: every handler, adapter, and service must follow the log tag convention (**mainLogTag** per file, **methodLogTag** per method; every message starts with methodLogTag; never pass logTag as parameter).
- **Context fields** on every log event: `tracking_id` (UUID v7), `platform_id` (when authenticated), `start_ts` (request start Unix ms).
- **Canonical log** dispatched at end of each request with `end_ts`, `duration_ms`, accumulated `canonical_meta` and `canonical_counters`.
- **HTTP middleware**: Global chain (order matters): `trackingCanonical` → `cors` → `secureHeaders` → `requestResponseLog`. Then per route group: `apiKeyAuth` → `idempotency` (mutations only). `trackingCanonical` injects tracking context and dispatches canonical; `requestResponseLog` logs request/response (reads body via clone). `cors` and `secureHeaders` are Hono built-ins (`hono/cors`, `hono/secure-headers`). Custom middlewares in `utils/middleware/`.
- **Sensitive keys**: `password`, `api_key`, `api_key_hash`, `secret`, `token`, `authorization`, `cookie`, `access_token`, `refresh_token`.

### Log level summary

| Level | Use for |
|-------|---------|
| **debug** | Handler entry with params, intermediate values (balance checks, hold sums), adapter queries, transaction begin/commit/rollback. |
| **info** | Business operation success (deposit, transfer, wallet created), noteworthy domain events (hold expired on-access, system wallet auto-created). |
| **warn** | Client errors (invalid JSON, validation failures), optimistic locking conflicts, expired holds on capture/void. |
| **error** | Server-side failures (5xx), infrastructure errors, unhandled exceptions. |
| **fatal** | Process cannot continue (port bind failure, startup errors). |

**Key rules**: Always log at handler entry (`debug`) and success (`info`). Always log early returns (`warn`/`info`). Log business-critical intermediate values (`debug`). Adapter methods log every DB call (`debug`). Client errors are `warn`, not `error`. Never log sensitive data.

See **[backend-architecture.md](backend-architecture.md)** § Logging for full detail and examples.

## Error Handling

- **AppError**: Kind (semantic category) + Code (stable UPPER_SNAKE_CASE) + Message (fallback). No external dependencies. Defined in `utils/kernel/appError.ts`.
- **Domain**: Defines error constructors returning `AppError`.
- **HTTP translation**: Two paths, same output shape `{"error": "CODE", "message": "..."}`:
  - **Handlers**: throw `AppError` — caught by global `onError` in `index.ts` which maps Kind → HTTP status via `httpStatus()` and responds with `errorResponse()`.
  - **Middleware** (apiKeyAuth, idempotency, validationHook): call `errorResponse()` directly with the appropriate status code.
  - Both use `errorResponse()` from `utils/infrastructure/hono.error.ts` — single source of truth for the error shape.
- Use `AppError.is()` or error checks; never compare with `===` on opaque errors.

## API

- REST for all operations.
- All mutations (deposit, withdraw, transfer, hold capture) **require** `Idempotency-Key` header.
- API key authentication for all non-health endpoints.
- **Auto-generated OpenAPI docs** via `hono-openapi` + `@scalar/hono-api-reference`:
  - `/openapi` — OpenAPI 3.1 JSON spec
  - `/docs` — Interactive Scalar UI
  - Request schemas auto-discovered from `validator()` calls; response schemas via `resolver()` in `describeRoute()`.
- **Endpoint file structure**: Each endpoint folder has `schemas.ts` (Zod request + response schemas) and `handler.ts` (describeRoute + validators + handler). See backend-architecture.md § HTTP handler.

## Listing and Pagination

Paginated GET endpoints use a **reusable listing system** (`utils/kernel/listing.ts` + `utils/infrastructure/listing.zod.ts` + `utils/infrastructure/listing.prisma.ts`).

**Design:**
- **Flat filters** (AND logic, no nesting): `filter[field]=value`, `filter[field][op]=value`. Operators: `eq`, `gt`, `gte`, `lt`, `lte`, `in`.
- **Dynamic multi-field sorting** with per-field direction: `sort=-amount_minor,created_at` (prefix `-` = desc).
- **Keyset cursor pagination** (not offset-based): cursor is an opaque base64url token encoding the keyset values + sort signature. Changing sort with an old cursor returns 400 `CURSOR_SORT_MISMATCH`.
- **Whitelist per endpoint**: Each endpoint declares a `ListingConfig` with allowed filterable fields, sortable fields, default sort, and limits. No arbitrary field access.
- **`createListingQuerySchema(config)`** generates a Zod schema with explicit keys for every `filter[field][op]` combination — compatible with hono-openapi for auto-documentation.
- **`buildPrismaListing()`** converts the domain `ListingQuery` into Prisma `where`/`orderBy`/`take` with WHERE-based keyset pagination (not Prisma's native cursor, which only works with `@id`).
- **Composite indexes** added for common filter+sort patterns to ensure query performance.

## Database

- PostgreSQL via Prisma ORM.
- Optimistic locking: `version` field on wallets; updates must match current version.
- **Double-entry ledger**: Every operation creates a **Movement** (journal entry) with 2 ledger entries (debit + credit) that must sum to zero. For transfers, both sides share the same `movement_id`. `ledger_entries` is immutable (DB trigger + REVOKE UPDATE/DELETE). Audit invariant: `SUM(amount_minor) GROUP BY movement_id = 0`.
- Idempotency records: TTL 48h; stored responses for safe retries. Includes `request_hash` (SHA-256) for payload mismatch detection.
- DB constraints enforce uniqueness and referential integrity as safety net.

## Concurrency Controls

| Control | Use |
|---------|-----|
| Distributed lock (LockRunner) | **Outer serialization layer** for mutating use cases. Acquires a Redis mutex keyed by resource ID (`wallet-lock:<walletId>`) before the transaction starts, so concurrent writers queue instead of racing. Optional (feature-flagged). If the backend is unreachable the runner falls through transparently and optimistic locking remains as the safety net. See § "Distributed Lock" below. |
| Optimistic locking | User wallet mutations (single and multi-wallet), **including PlaceHold and VoidHold** which call `wallet.touchForHoldChange()` + `walletRepo.save()` to participate in version contention. `version` field checked on save; mismatch → VERSION_CONFLICT. TransactionManager retries internally (3 attempts, exponential backoff); if exhausted, escalates `409 VERSION_CONFLICT` to client, who retries with same idempotency key. |
| System wallet sharding | Every movement debits/credits a system wallet for `(platform, currency)` to keep the ledger zero-sum. The system side is sharded into N buckets (default 32) keyed by `wallets.shard_index`; each mutation routes to a bucket via a deterministic FNV-1a hash of the user wallet id and writes with a single `UPDATE … RETURNING` (atomic increment, no read-then-write). Sharding is the mechanism that stops the system wallet from becoming a hot-row bottleneck under cross-wallet concurrency. Shard count is per-platform and only-increase. See § "System Wallet Sharding" below. |
| Idempotency keys | All mutations. Atomic acquire pattern: INSERT pending record before execution; concurrent duplicates get `409 IDEMPOTENCY_KEY_IN_PROGRESS` or cached response. Transient errors (5xx, 409) are released, not cached. Request hash includes `method:path:body` so the same key on a different endpoint is rejected. Payload mismatch → `422 IDEMPOTENCY_PAYLOAD_MISMATCH`. |
| DB constraints | Uniqueness, referential integrity, positive amounts, balance rules as safety net. |

### Why optimistic locking, not SELECT FOR UPDATE

We use optimistic locking (version field) for **user wallet** mutations, including multi-wallet operations like transfers. System wallets use atomic increment (`cached_balance_minor + delta`) on a sharded row (see § "System Wallet Sharding") instead of a version check — they have no balance constraints that require read-before-write. We deliberately avoid `SELECT FOR UPDATE` (pessimistic locking) because:

1. **Hexagonal purity**: `SELECT FOR UPDATE` is a SQL-specific concept. Putting it in the domain port (`WalletRepository.findByIdForUpdate`) leaks infrastructure into the domain. If we switch to MongoDB, DynamoDB, or an event store, pessimistic row locking doesn't exist. The `version` field is database-agnostic — any persistence adapter can implement it.

2. **Sufficient safety**: Optimistic locking catches all conflicts. If two concurrent requests modify the same wallet, the second `save()` sees a version mismatch and throws `VERSION_CONFLICT`. The client retries with the same idempotency key. No data is corrupted.

3. **Better for low-contention workloads**: Pessimistic locks hold rows locked for the duration of the transaction, blocking other readers. Optimistic locking only fails on actual conflict, which is rare for typical wallet workloads.

4. **Trade-off**: Under very high contention (many concurrent operations on the same wallet), optimistic locking causes more retries. If this becomes a problem, pessimistic locking can be added **inside the Prisma adapter** (implementation detail) without changing the domain port. The adapter could internally use `SELECT FOR UPDATE` before save, transparent to the domain.

## Distributed Lock (per-resource serialization)

An **outer serialization layer** in front of optimistic locking. Eliminates the 409 VERSION_CONFLICT storm that hits when many writers queue on the same aggregate by making them wait on a shared Redis key instead of racing on the DB version. **The distributed lock does not replace optimistic locking — it funnels writers so they hit the DB one at a time.** If the lock layer is disabled or Redis is unreachable, optimistic locking still catches conflicts.

### Components

| Layer | File | Responsibility |
|---|---|---|
| Port | `src/utils/application/distributed.lock.ts` | `IDistributedLock` (`acquire` / `withLock` / `withLocks`), plus `LockContendedError` and `LockBackendUnavailableError`. Pure application contract — zero third-party imports. |
| App service | `src/utils/application/lock.runner.ts` | `LockRunner` — the thing use cases inject. Wraps the port with `LockOptions` + `ILogger`, applies the feature toggle (`lock=undefined` → run `fn` directly), translates `LockContendedError` to `AppError.conflict("LOCK_CONTENDED")`, and degrades on backend failure by running `fn` without the lock. |
| Adapter | `src/utils/infrastructure/redis.distributed.lock.ts` | `RedisDistributedLock` — ioredis-backed. `SET NX PX` poll loop with transient-error reclassification (`Command timed out` keeps retrying within `waitMs`; real connection errors escalate). Token-aware release via Lua script so TTL expiry mid-critical-section cannot release someone else's lock. |

### Contract

- **Feature toggle**: `LockRunner` with `lock = undefined` is the ONLY supported way to express "feature disabled". Application code and tests must never construct one manually to bypass the lock; use `createMockLockRunner()` from `test/helpers/mocks/` in tests.
- **Keys are opaque**: the runner doesn't know about wallets. Callers pass namespaced strings (`wallet-lock:<walletId>`, `hold-lock:<holdId>`, …). Prefix per resource type prevents collisions across features.
- **Ordering**: `withLocks(keys)` sorts + dedupes the key list before acquiring, so two callers that need the same pair (transfer A→B vs B→A) acquire in the same order and cannot deadlock.
- **Release** always runs a token-aware Lua script — a stale call after TTL expiry returns `deleted=0`, which is logged at `warn` with `lock.token_mismatch` incremented. This is a correctness signal: the critical section was longer than the TTL and a second holder may have overlapped.

### Usage pattern

Inside a command use case, wrap the transactional body:

```ts
await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
  await this.txManager.run(ctx, async (txCtx) => {
    const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
    if (!wallet) throw ErrWalletNotFound(cmd.walletId);
    // ... mutate, persist ...
  });
});
```

**Lock order**: `lockRunner.run()` **wraps** `txManager.run()`, never the other way around. The Redis lock exists to *prevent* the tx from even starting under contention; holding a DB transaction while waiting for a Redis mutex would multiply resource pressure.

Multi-key example (transfer locks both wallets):

```ts
await this.lockRunner.run(
  ctx,
  [`wallet-lock:${cmd.sourceWalletId}`, `wallet-lock:${cmd.targetWalletId}`],
  async () => {
    await this.txManager.run(ctx, async (txCtx) => { /* ... */ });
  },
);
```

### When to use it

Use the distributed lock when **both** conditions hold:

1. The use case performs concurrent mutations to the same logical resource that today produce `VERSION_CONFLICT` under real load, or that have a race window you want to close.
2. The resource is addressable by a stable ID (wallet, account, hold's wallet, external entity ID).

Currently wired on all 12 mutation use cases that touch user wallets: `deposit`, `withdraw`, `transfer`, `charge`, `adjustBalance`, `placeHold`, `captureHold`, `voidHold`, `freezeWallet`, `unfreezeWallet`, `closeWallet`, `importHistoricalEntry`. `createWallet` and read-side use cases are NOT locked.

**Don't use it for**:

- Read-only operations (query side) — no contention to serialize.
- Commands without a natural per-resource key (e.g. `ExpireHoldsUseCase` processes a batch; no single lock key makes sense).
- Hot global resources like the platform-level system wallet — locking it globally would serialize the whole platform. The current code handles system-wallet concurrency via atomic increments (`adjustSystemWalletBalance`) instead.

### Security invariants (pre-lock validation)

Acquiring a lock on a key derived from user-supplied input is a small but real DoS vector: an attacker can force the service to take a lock on a victim's resource for a few milliseconds. **Always validate ownership before acquiring the lock.** Examples:

- `captureHold` / `voidHold` resolve `holdId → walletId` outside the transaction to build the lock key, then **validate `wallet.platformId === cmd.platformId`** before calling `lockRunner.run`. A mismatch throws `HOLD_NOT_FOUND` with no information leak and no lock is taken.
- Commands with a direct `walletId` from the path parameter rely on the inner tx's platform check (the walletId came from an authenticated route with no cross-tenant read path).

### Fallthrough behavior

- `WALLET_LOCK_ENABLED=false` or `REDIS_URL` missing → wiring injects a no-op runner. No lock, no warns, no canonical metrics emitted.
- `WALLET_LOCK_ENABLED=true` but Redis unreachable → `RedisDistributedLock` throws `LockBackendUnavailableError`. `LockRunner` catches it, logs `warn` ("backend down, proceeding without lock"), increments `lock.fallthrough`, and runs `fn` without serialization. Optimistic locking remains the safety net.
- Contention exhausts `waitMs` → `LockContendedError` → `AppError.conflict("LOCK_CONTENDED")` → HTTP 409. Client retries with the **same** `Idempotency-Key`. The idempotency middleware releases the key on 409 so the retry is accepted.

### Configuration (see techContext.md for the full table)

| Env var | Default | Purpose |
|---|---|---|
| `WALLET_LOCK_ENABLED` | `false` | Feature toggle. |
| `REDIS_URL` | unset | `redis://host:port` (local) or `rediss://default:TOKEN@host:port` (Upstash, etc.). Required when enabled. Both transports parse the same URL. |
| `WALLET_LOCK_TRANSPORT` | `tcp` | `tcp` → ioredis (persistent connection, ~1-5ms per op). `rest` → `@upstash/redis` over HTTPS (stateless per-request, no connection quota to exhaust on serverless bursts; ~10-30ms per op). REST parses host+token out of `REDIS_URL` and builds an `https://<host>` endpoint. |
| `WALLET_LOCK_TTL_MS` | `10000` | Lock auto-expiry. Must exceed the longest legitimate critical section. |
| `WALLET_LOCK_WAIT_MS` | `5000` | How long a waiter blocks before rejecting with `LOCK_CONTENDED`. Must be shorter than the HTTP request timeout. |
| `WALLET_LOCK_RETRY_MS` | `50` | Polling interval between `SET NX` attempts while waiting. |

### Choosing a transport

- **`tcp` (default)** — use for local development, long-lived Node processes, or any environment with a stable connection pool. Lower latency per op, uses Upstash/Redis connections.
- **`rest`** — use for serverless (Vercel, AWS Lambda, Cloudflare Workers). Cold-start bursts open many concurrent TCP connections to Redis and can exhaust the provider's per-DB quota (Upstash: `EMAXCONN`). HTTP is stateless — each lock op is an independent request, unaffected by peak concurrency.

Wire protocol (`SET NX PX` for acquire + token-aware Lua `EVAL` for release) is identical across transports; the same Upstash DB can run mixed clients safely.

### Observability (per-request canonical metrics)

Seven additive counters on the request's canonical log line:

| Field | Source | Meaning |
|---|---|---|
| `lock.attempts` | adapter | `SET NX` calls made (retries included) |
| `lock.transient_errors` | adapter (TCP only) | `Command timed out` retries absorbed by the classifier. REST transport has no command-timeout concept — any error is treated as backend-unavailable. |
| `lock.token_mismatch` | adapter (release) | TTL expired mid-critical-section — potential invariant break |
| `lock.acquired` | runner | Successful run |
| `lock.contended` | runner | 409 LOCK_CONTENDED emitted |
| `lock.fallthrough` | runner | Backend down, ran without the lock |
| `lock.duration_ms` | runner | Total time in `lockRunner.run` |

Plus structured logs at every transition (acquire start/ok/contended/backend-error, release ok/token-mismatch/backend-error, Redis connection lifecycle in wiring).

### Testing notes

- Use cases: mock `LockRunner` via `createMockLockRunner()` (pass-through — executes `fn` directly without touching the real port).
- Adapter: unit-tested against a `mock<Redis>` from `vitest-mock-extended`.
- E2E: [tests/e2e/wallet/wallet-lock.e2e.test.ts](../../tests/e2e/wallet/wallet-lock.e2e.test.ts) covers happy-path concurrency, cross-wallet parallelism, mixed mutations, and **forced contention via an external Redis holder** (connects to Redis at `localhost:6380` and holds the key with a foreign token) to validate the 409 LOCK_CONTENDED wire path.

## System Wallet Sharding

### Why

Every financial movement (deposit, withdraw, charge, adjust, captureHold, importHistoricalEntry) debits or credits a **system wallet** for the `(platform, currency)` pair to preserve the double-entry ledger's zero-sum invariant. With a single system wallet per `(platform, currency)` that row becomes a hot account: cross-wallet concurrency ends up serializing on it, and under `SERIALIZABLE` isolation PostgreSQL aborts the losing transactions with `40001 / TransactionWriteConflict`. Pre-sharding load tests with 350 wallets × 4 concurrent ops cleared well below 25% success.

Sharding fans the system side out over N deterministic buckets, so `SUM(shard_balance) + SUM(user_balance) = 0` remains the invariant while the concurrent write footprint drops from "one row" to "N rows".

### Data model

- **`platforms.system_wallet_shard_count`** (int, default 32, 1..1024, only-increase) — how many shards exist for each `(platform, currency)` under this tenant.
- **`wallets.shard_index`** (int NOT NULL, default 0, CHECK >= 0) — the bucket the row belongs to. User wallets keep `shard_index = 0`; system wallets span `0..shard_count-1`.
- **Unique constraint** on `(owner_id, platform_id, currency_code, shard_index)`. NOT NULL is required because Postgres treats NULLs as distinct, which would let duplicate user wallets slip past.
- Immutable-ledger trigger (`prevent_wallet_field_tampering`) protects `shard_index` against `UPDATE` alongside id/owner/platform/currency/is_system.

### Routing (deterministic, application-side)

- Pure FNV-1a 32-bit hash over the **user wallet id**: `systemWalletShardIndex(userWalletId, shardCount)` lives in `src/utils/kernel/shard.ts`. Same user wallet → same shard for the life of the platform's shard count.
- When the shard count grows, existing movements keep routing to old buckets; new wallets distribute across the expanded range. Historical ledger entries are never rewritten.

### Transparent reads

Balances are computed as `SUM(cached_balance_minor) WHERE is_system = true AND platform_id = ? AND currency_code = ?` via `IWalletRepository.sumSystemWalletBalance`. Public read stores filter `is_system = false`, so API consumers never see the shard rows.

### Write path (UPDATE + RETURNING, single statement)

Mutation use cases route the system side via:

```ts
const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
const systemSide = await this.walletRepo.adjustSystemShardBalance(
  txCtx, wallet.platformId, wallet.currencyCode, shardIndex, delta, now,
);
// systemSide.walletId feeds the ledger entry; systemSide.cachedBalanceMinor = balance_after.
```

`adjustSystemShardBalance` compiles to `UPDATE wallets SET cached_balance_minor = cached_balance_minor + $delta, updated_at = $now WHERE owner_id = 'SYSTEM' AND platform_id = ? AND currency_code = ? AND shard_index = ? RETURNING id, cached_balance_minor`. Doing the read and the write in one statement avoids the read/write dependency that `SERIALIZABLE` would otherwise turn into an abort.

### Materialisation

- **Lazy, idempotent.** `ensureSystemWalletShards(ctx, platformId, currencyCode, count, now)` runs a `findMany` + `createMany({ skipDuplicates: true })` so concurrent callers converge on the same N rows.
- Called **outside the transaction** from `CreateWalletUseCase` — materialising inside the SERIALIZABLE tx caused read/write conflicts on the shard rows under concurrent createWallet requests for the same `(platform, currency)`.
- Also called from `UpdatePlatformConfigUseCase` when `system_wallet_shard_count` increases: it lists every currency already in use for the platform and ensures the expanded shard set for each.

### Config update semantics

- `UpdatePlatformConfigUseCase` accepts an optional `systemWalletShardCount`. The Platform aggregate enforces **only-increase** (`setSystemWalletShardCount` rejects any value < current) and bounds `1..1024`. Shrinking would silently strand balance in "orphan" shards that no live user wallet hashes into.
- Defaults live in `src/platform/domain/platform/platform.aggregate.ts`: `DEFAULT_SYSTEM_WALLET_SHARD_COUNT = 32`, `MAX_SYSTEM_WALLET_SHARD_COUNT = 1024`.

### Interaction with the TransactionManager

With sharding in place, remaining `SERIALIZABLE` aborts come from genuine cross-row contention at high concurrency. The TransactionManager's `isRetryable` predicate matches:
- `AppError.VERSION_CONFLICT`
- Prisma `P2034`
- Error `.name === "TransactionWriteConflict"`
- Messages containing `"TransactionWriteConflict"`, `"could not serialize access"`, or `"write conflict"`.

After 3 internal retries it wraps any remaining serialization failure as `409 VERSION_CONFLICT`, which clients retry with the same `Idempotency-Key`. Non-retryable errors still surface as `500`.

### Testing

- Unit: [tests/unit/utils/kernel/shard.test.ts](../../tests/unit/utils/kernel/shard.test.ts), [tests/unit/wallet/infrastructure/prisma/wallet.prisma.test.ts](../../tests/unit/wallet/infrastructure/prisma/wallet.prisma.test.ts) covers `findSystemShard`, `adjustSystemShardBalance`, `ensureSystemWalletShards`, `sumSystemWalletBalance`, `listSystemWalletCurrencies`.
- E2E: [tests/e2e/wallet/system-wallet-sharding.e2e.test.ts](../../tests/e2e/wallet/system-wallet-sharding.e2e.test.ts) asserts `>95%` success on a 150-wallet × 4-op cross-wallet load test, the ledger zero-sum invariant across all shards, default shard count = 32, lazy re-materialisation after a shard is deleted, and that system shards never leak into the public `/v1/wallets` listing.

## BigInt Serialization

Prisma returns `BigInt` fields as native `bigint`, which does not serialize to JSON. Strategy:
- Use `utils/kernel/bigint.ts` utilities (`toSafeNumber`, `toNumber`, `bigIntReplacer`) in adapters/DTOs.
- Amounts and timestamps that fit within `Number.MAX_SAFE_INTEGER` (~9 quadrillion minor units) → convert to `number`.
- System wallet balances that may exceed safe range → serialize as `string`.
- API DTOs document whether each field is `number` or `string`.

## Idempotency Record Cleanup

- Records have 48h TTL (`expires_at` field).
- A background job (`common/idempotency/infrastructure/adapters/inbound/scheduler/cleanupIdempotency.job.ts`) dispatches a `CleanupIdempotencyCommand` via the CommandBus every 60s. The use case (`common/idempotency/application/command/cleanupIdempotency/usecase.ts`) deletes records where `expires_at < now()`.
- Scheduled jobs are inbound adapters — same pattern as HTTP routes dispatching commands via the bus.
- At scale (1M+ tx/day), consider partitioning `idempotency_records` by `created_at` using `pg_partman`.

## Hold Expiration

- Expired holds are detected **on-access** (when calculating available_balance) and **via batch cron**.
- On-access: any query/command that reads active holds for a wallet must filter `WHERE (expires_at IS NULL OR expires_at > now())`.
- Batch: periodic job (`wallet/infrastructure/adapters/inbound/scheduler/expireHolds.job.ts`) dispatches an `ExpireHoldsCommand` via the CommandBus. The use case marks expired holds as `expired` status.

## References

- [backend-architecture.md](backend-architecture.md) — Backend structure and setup
- [techContext.md](techContext.md) — Stack and environment
- [database-migrations.md](database-migrations.md) — Prisma migrations
- [domain.md](../domain.md) — Business rules
- [datamodel.md](../datamodel.md) — Data structures
