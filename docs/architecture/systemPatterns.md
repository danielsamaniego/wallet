# System Patterns — Wallet Service

Architecture patterns and technical decisions for the Wallet Service.

## Backend

**DDD + Hexagonal (Ports & Adapters) + CQRS** — **without Event Sourcing or Event-Driven** patterns. Coordination between bounded contexts is synchronous (direct function calls, no message bus).

- **Dependency rule**: Domain and app must **not** import from adapters or HTTP. They depend only on interfaces (ports) and shared packages (`appError`, `kernel`, `observability`). Third-party libs (Prisma, Pino, uuidv7) live only in adapters.
- **ID generation — UUID v7 only, from application**: `IDGenerator` interface; implementation uses `uuidv7`. App generates all IDs; DB never generates them (no `DEFAULT gen_random_uuid()`).
- **Amounts**: Integer cents (`bigint` / BigInt) everywhere. All financial amounts in smallest currency unit; no floating point.
- **Timestamps**: Unix milliseconds (ms since epoch) everywhere: DB (BigInt), domain, ports, DTOs, API.
- **Commands**: Write side; mutate aggregates via domain repositories (interface). May return minimal data (e.g. created ID) — see backend-architecture.md for rationale.
- **Queries**: Read side; return DTOs via ReadStore (interface); no aggregate loading for display.
- **No Event Sourcing**: The immutable `ledger_entries` table provides the audit trail that Event Sourcing would offer. Direct state persistence with `cached_balance_cents` gives O(1) reads without event replay. See backend-architecture.md § "No Event Sourcing — and why" for full rationale.
- **No Event-Driven**: BCs communicate synchronously within the same process. No message bus, no eventual consistency.
- **Driving adapters**: HTTP (Hono); each route group has its own setup.
- **Outgoing adapters**: PostgreSQL (Prisma).

See **[backend-architecture.md](backend-architecture.md)** for full directory layout, bounded contexts, and handler rules.

## Logging

Structured logging via port `Logger` (implementation: PinoAdapter in `shared/observability/adapters/`). Wiring chain: **PinoAdapter → SensitiveKeysFilter** (omits configured keys, recursive through nested objects) → **SafeLogger** (logger failure never stops execution).

- **Applied across the entire backend**: every handler, adapter, and service must follow the log tag convention (**mainLogTag** per file, **methodLogTag** per method; every message starts with methodLogTag; never pass logTag as parameter).
- **Context fields** on every log event: `tracking_id` (UUID v7), `platform_id` (when authenticated), `start_ts` (request start Unix ms).
- **Canonical log** dispatched at end of each request with `end_ts`, `duration_ms`, accumulated `canonical_meta` and `canonical_counters`.
- **HTTP middleware**: `trackingCanonical` (global) injects tracking context and dispatches canonical; `requestResponseLog` (global) logs request/response (reads body via clone to preserve stream).
- **Sensitive keys**: `password`, `api_key`, `api_key_hash`, `secret`, `token`, `authorization`, `cookie`, `access_token`, `refresh_token`.

See **[backend-architecture.md](backend-architecture.md)** § Logging for full detail.

## Error Handling

- **AppError**: Kind (semantic category) + Code (stable UPPER_SNAKE_CASE) + Message (fallback). No external dependencies.
- **Domain**: Defines error constructors returning `AppError`.
- **HTTP translation**: `withError()` maps Kind → HTTP status, returns `{"error": "CODE", "message": "..."}`. Unknown errors → 500 `INTERNAL_ERROR`.
- Use `AppError.is()` or error checks; never compare with `===` on opaque errors.

## API

- REST for all operations.
- All mutations (deposit, withdraw, transfer, hold capture) **require** `Idempotency-Key` header.
- API key authentication for all non-health endpoints.
- **API.md mandatory** per endpoint group under `api/`.

## Database

- PostgreSQL via Prisma ORM.
- Optimistic locking: `version` field on wallets; updates must match current version.
- **SELECT FOR UPDATE** for multi-wallet ops (e.g., transfers) to prevent races.
- **Double-entry ledger**: Every operation produces 2 entries (debit + credit). `ledger_entries` is immutable (DB trigger + REVOKE UPDATE/DELETE).
- Idempotency records: TTL 48h; stored responses for safe retries.
- DB constraints enforce uniqueness and referential integrity as safety net.

## Concurrency Controls

| Control | Use |
|---------|-----|
| Optimistic locking | Single-wallet updates via `version`. On mismatch → `409 VERSION_CONFLICT`; client retries with same idempotency key. |
| SELECT FOR UPDATE | Multi-wallet atomic ops (transfers, hold capture). Lock in deterministic `ORDER BY id` to prevent deadlocks. |
| Idempotency keys | All mutations. Atomic acquire pattern: INSERT pending record before execution; concurrent duplicates get `409 IDEMPOTENCY_KEY_IN_PROGRESS` or cached response. |
| DB constraints | Uniqueness, referential integrity, positive amounts, balance rules as safety net. |

## BigInt Serialization

Prisma returns `BigInt` fields as native `bigint`, which does not serialize to JSON. Strategy:
- Use `shared/kernel/bigint.ts` utilities (`toSafeNumber`, `toNumber`, `bigIntReplacer`) in adapters/DTOs.
- Amounts and timestamps that fit within `Number.MAX_SAFE_INTEGER` (~9 quadrillion cents) → convert to `number`.
- System wallet balances that may exceed safe range → serialize as `string`.
- API DTOs document whether each field is `number` or `string`.

## Idempotency Record Cleanup

- Records have 48h TTL (`expires_at` field).
- A periodic batch job (cron) must `DELETE FROM idempotency_records WHERE expires_at < now()`.
- At scale (1M+ tx/day), consider partitioning `idempotency_records` by `created_at` using `pg_partman`.

## Hold Expiration

- Expired holds are detected **on-access** (when calculating available_balance) and **via batch cron**.
- On-access: any query/command that reads active holds for a wallet must filter `WHERE (expires_at IS NULL OR expires_at > now())`.
- Batch: periodic job marks expired holds as `expired` status.

## References

- [backend-architecture.md](backend-architecture.md) — Backend structure and setup
- [techContext.md](techContext.md) — Stack and environment
- [database-migrations.md](database-migrations.md) — Prisma migrations
- [domain.md](../domain.md) — Business rules
- [datamodel.md](../datamodel.md) — Data structures
