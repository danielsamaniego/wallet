# System Patterns — Wallet Service

Architecture patterns and technical decisions for the Wallet Service.

## Backend

**DDD + Hexagonal (Ports & Adapters) + CQRS** — **without Event Sourcing or Event-Driven** patterns. Coordination between bounded contexts is synchronous (direct function calls, no message bus).

- **Dependency rule**: Domain and app must **not** import from adapters or HTTP. They depend only on interfaces (ports) and `utils/kernel/` packages. Never import from `utils/infrastructure/` or `utils/middleware/` in domain or app — that's an architecture violation. Third-party libs (Prisma, Pino, uuidv7, Hono) live only in adapters.
- **ID generation — UUID v7 only, from application**: `IIDGenerator` interface; implementation uses `uuidv7`. App generates all IDs; DB never generates them (no `DEFAULT gen_random_uuid()`).
- **Amounts**: Integer values in smallest currency unit per ISO 4217 (`bigint` / BigInt) everywhere. Column names use `_cents` as convention; the actual unit depends on the currency's minor unit exponent (2 for USD/EUR, 0 for JPY, 3 for BHD). No floating point.
- **Timestamps**: Unix milliseconds (ms since epoch) everywhere: DB (BigInt), domain, ports, DTOs, API.
- **Commands**: Write side; mutate aggregates via domain repositories (interface). May return minimal data (e.g. created ID) — see backend-architecture.md for rationale. Dispatched via `ICommandBus`.
- **Queries**: Read side; return DTOs via ReadStore (interface); no aggregate loading for display. Dispatched via `IQueryBus`.
- **No Event Sourcing**: The immutable `ledger_entries` table provides the audit trail that Event Sourcing would offer. Direct state persistence with `cached_balance_cents` gives O(1) reads without event replay. See backend-architecture.md § "No Event Sourcing — and why" for full rationale.
- **No Event-Driven**: BCs communicate synchronously within the same process. No message bus, no eventual consistency.
- **Driving/inbound adapters**: HTTP (Hono route files in `wallet/infrastructure/adapters/inbound/http/`) and scheduled jobs (in `wallet/infrastructure/adapters/inbound/scheduler/` and `common/idempotency/infrastructure/adapters/inbound/scheduler/`).
- **Outgoing/outbound adapters**: PostgreSQL (Prisma) in `wallet/infrastructure/adapters/outbound/prisma/`.
- **Outbound port convention**: All outbound port methods (repositories, read stores, transaction manager) receive `ctx: AppContext` as their first parameter. Adapters receive `ILogger` in their constructor. This enables adapters to log with full traceability (`tracking_id`, `platform_id`) without leaking infrastructure into the domain.

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

### Server-side retry (internal to TransactionManager)

The `PrismaTransactionManager` includes an **internal retry loop** (up to 3 attempts with exponential backoff: 30ms, 60ms, 120ms) for retryable errors:

- **VERSION_CONFLICT**: Our domain-level optimistic locking error.
- **PostgreSQL serialization failure** (SQLSTATE 40001 / Prisma P2034): Thrown under Serializable isolation when PostgreSQL detects a read/write dependency conflict.

If all retries are exhausted, serialization failures are escalated as `VERSION_CONFLICT` (409) so the client can retry with the same idempotency key. Non-retryable errors propagate immediately without retry.

This means the client sees retries only when the server's internal attempts are insufficient — for most low-contention workloads, conflicts resolve within the 3 internal attempts without the client ever knowing.

## Logging

**Production goal: full traceability.** Every request must be reconstructable from logs alone — follow `tracking_id` through HTTP → app handler → adapter → DB.

Structured logging via port `ILogger` (`utils/kernel/observability/logger.port.ts`; implementation: PinoAdapter in `utils/infrastructure/observability/`). Wiring chain: **PinoAdapter → SensitiveKeysFilter** (omits configured keys, recursive through nested objects) → **SafeLogger** (logger failure never stops execution).

- **Applied across the entire backend**: every handler, adapter, and service must follow the log tag convention (**mainLogTag** per file, **methodLogTag** per method; every message starts with methodLogTag; never pass logTag as parameter).
- **Context fields** on every log event: `tracking_id` (UUID v7), `platform_id` (when authenticated), `start_ts` (request start Unix ms).
- **Canonical log** dispatched at end of each request with `end_ts`, `duration_ms`, accumulated `canonical_meta` and `canonical_counters`.
- **HTTP middleware**: `trackingCanonical` (global) injects tracking context and dispatches canonical; `requestResponseLog` (global) logs request/response (reads body via clone to preserve stream). Both in `utils/middleware/`.
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
- **Dynamic multi-field sorting** with per-field direction: `sort=-amount_cents,created_at` (prefix `-` = desc).
- **Keyset cursor pagination** (not offset-based): cursor is an opaque base64url token encoding the keyset values + sort signature. Changing sort with an old cursor returns 400 `CURSOR_SORT_MISMATCH`.
- **Whitelist per endpoint**: Each endpoint declares a `ListingConfig` with allowed filterable fields, sortable fields, default sort, and limits. No arbitrary field access.
- **`createListingQuerySchema(config)`** generates a Zod schema with explicit keys for every `filter[field][op]` combination — compatible with hono-openapi for auto-documentation.
- **`buildPrismaListing()`** converts the domain `ListingQuery` into Prisma `where`/`orderBy`/`take` with WHERE-based keyset pagination (not Prisma's native cursor, which only works with `@id`).
- **Composite indexes** added for common filter+sort patterns to ensure query performance.

## Database

- PostgreSQL via Prisma ORM.
- Optimistic locking: `version` field on wallets; updates must match current version.
- **Double-entry ledger**: Every operation creates a **Movement** (journal entry) with 2 ledger entries (debit + credit) that must sum to zero. For transfers, both sides share the same `movement_id`. `ledger_entries` is immutable (DB trigger + REVOKE UPDATE/DELETE). Audit invariant: `SUM(amount_cents) GROUP BY movement_id = 0`.
- Idempotency records: TTL 48h; stored responses for safe retries. Includes `request_hash` (SHA-256) for payload mismatch detection.
- DB constraints enforce uniqueness and referential integrity as safety net.

## Concurrency Controls

| Control | Use |
|---------|-----|
| Optimistic locking | User wallet mutations (single and multi-wallet), **including PlaceHold and VoidHold** which call `wallet.touchForHoldChange()` + `walletRepo.save()` to participate in version contention. `version` field checked on save; mismatch → VERSION_CONFLICT. TransactionManager retries internally (3 attempts, exponential backoff); if exhausted, escalates `409 VERSION_CONFLICT` to client, who retries with same idempotency key. **System wallets** use `adjustSystemWalletBalance()` with atomic increment instead — no version check needed, eliminates hot-row contention. |
| Idempotency keys | All mutations. Atomic acquire pattern: INSERT pending record before execution; concurrent duplicates get `409 IDEMPOTENCY_KEY_IN_PROGRESS` or cached response. Transient errors (5xx, 409) are released, not cached. Request hash includes `method:path:body` so the same key on a different endpoint is rejected. Payload mismatch → `422 IDEMPOTENCY_PAYLOAD_MISMATCH`. |
| DB constraints | Uniqueness, referential integrity, positive amounts, balance rules as safety net. |

### Why optimistic locking, not SELECT FOR UPDATE

We use optimistic locking (version field) for **user wallet** mutations, including multi-wallet operations like transfers. System wallets use atomic increment (`cached_balance_cents + delta`) instead of version check — they have no balance constraints that require read-before-write. We deliberately avoid `SELECT FOR UPDATE` (pessimistic locking) because:

1. **Hexagonal purity**: `SELECT FOR UPDATE` is a SQL-specific concept. Putting it in the domain port (`WalletRepository.findByIdForUpdate`) leaks infrastructure into the domain. If we switch to MongoDB, DynamoDB, or an event store, pessimistic row locking doesn't exist. The `version` field is database-agnostic — any persistence adapter can implement it.

2. **Sufficient safety**: Optimistic locking catches all conflicts. If two concurrent requests modify the same wallet, the second `save()` sees a version mismatch and throws `VERSION_CONFLICT`. The client retries with the same idempotency key. No data is corrupted.

3. **Better for low-contention workloads**: Pessimistic locks hold rows locked for the duration of the transaction, blocking other readers. Optimistic locking only fails on actual conflict, which is rare for typical wallet workloads.

4. **Trade-off**: Under very high contention (many concurrent operations on the same wallet), optimistic locking causes more retries. If this becomes a problem, pessimistic locking can be added **inside the Prisma adapter** (implementation detail) without changing the domain port. The adapter could internally use `SELECT FOR UPDATE` before save, transparent to the domain.

## BigInt Serialization

Prisma returns `BigInt` fields as native `bigint`, which does not serialize to JSON. Strategy:
- Use `utils/kernel/bigint.ts` utilities (`toSafeNumber`, `toNumber`, `bigIntReplacer`) in adapters/DTOs.
- Amounts and timestamps that fit within `Number.MAX_SAFE_INTEGER` (~9 quadrillion cents) → convert to `number`.
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
