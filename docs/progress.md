# Progress — Wallet Service

## What Works

- [x] Project initialized (pnpm, TypeScript strict, Biome, Vitest)
- [x] Docker Compose (PostgreSQL 16 for local dev)
- [x] Dockerfile (multi-stage Node.js)
- [x] pnpm scripts for all workflows (`start:local`, `reset:local`, `db:update`, etc.)
- [x] Utils: AppError (Kind + Code + Message) in `utils/kernel/appError.ts`
- [x] Utils: IIDGenerator interface (`utils/application/id.generator.ts`) + UUID v7 adapter (`utils/infrastructure/uuidV7.ts`)
- [x] Utils: AppContext + createAppContext factory (`utils/kernel/context.ts`) + HonoVariables types (`utils/infrastructure/hono.context.ts`)
- [x] Utils: ILogger port (`utils/kernel/observability/logger.port.ts`) with canonical log support
- [x] Utils: SafeLogger (never throws) in `utils/infrastructure/observability/safe.logger.ts`
- [x] Utils: SensitiveKeysFilter (omits sensitive keys) in `utils/infrastructure/observability/sensitive.filter.ts`
- [x] Utils: CanonicalAccumulator (request-scoped meta + counters) in `utils/kernel/observability/canonical.ts`
- [x] Utils: PinoAdapter (structured JSON logging with context fields) in `utils/infrastructure/observability/pino.adapter.ts`
- [x] CQRS bus: ICommandBus/IQueryBus interfaces (`utils/application/cqrs.ts`) and implementations (`utils/infrastructure/cqrs.ts`) with middleware pipeline
- [x] TransactionManager: Serializable isolation + internal retry (3 attempts, exponential backoff) in `utils/infrastructure/prisma.transaction.manager.ts`
- [x] Middleware: trackingCanonical (tracking_id UUID v7 + canonical dispatch) in `utils/middleware/trackingCanonical.ts`
- [x] Middleware: requestResponseLog (request/response logging) in `utils/middleware/requestResponseLog.ts`
- [x] Middleware: apiKeyAuth (API key validation) in `utils/middleware/apiKeyAuth.ts`
- [x] Middleware: idempotency (duplicate prevention) in `utils/middleware/idempotency.ts`
- [x] Error handling: errorResponse + httpStatus + validationHook (`utils/infrastructure/hono.error.ts`)
- [x] Global onError handler (maps AppError → HTTP status, catches unhandled exceptions)
- [x] Prisma schema (all models)
- [x] Immutable ledger SQL (trigger + constraints)
- [x] Hono app with health endpoint, cors (hono/cors), secureHeaders (hono/secure-headers), notFound, basePath("/v1"), route() sub-apps
- [x] Config from env vars
- [x] Centralized DI wiring (repos + use cases + bus registration in wiring.ts)
- [x] HTTP handlers using handlerFactory.createHandlers() with hono-openapi validator (type-safe, no try/catch)
- [x] HTTP handlers dispatch via commandBus/queryBus (not individual handler instances)
- [x] Tracking middleware supports external X-Tracking-Id header (ext- prefix)
- [x] Auto-generated OpenAPI 3.1 spec via hono-openapi (`/openapi` endpoint)
- [x] Interactive Scalar API reference UI (`/docs` endpoint)
- [x] describeRoute() with tags, summary, and response schemas on all 13 endpoints
- [x] Endpoint schemas.ts files: request schemas (Param, Body, QueryParams) + ResponseSchema per endpoint
- [x] Shared ErrorResponseSchema in `utils/infrastructure/hono.error.ts`
- [x] Reusable listing system: flat Stripe-style filters, dynamic multi-field sorting, keyset cursor pagination
- [x] Listing modules: `utils/kernel/listing.ts` (domain types + cursor encode/decode), `utils/infrastructure/listing.zod.ts` (schema factory), `utils/infrastructure/listing.prisma.ts` (query builder)
- [x] Composite indexes for common filter+sort patterns (Transaction, LedgerEntry)
- [x] Full documentation set
- [x] AGENTS.md
- [x] CLAUDE.md importing `AGENTS.md`

## Implemented

- [x] Wallet bounded context: domain (aggregate, value objects, errors, Movement entity)
- [x] Wallet bounded context: app (command use cases: createWallet, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freeze, unfreeze, close, expireHolds) — each with `command.ts` + `usecase.ts`
- [x] Wallet bounded context: app (query use cases: getWallet, getTransactions, getLedgerEntries) — each with `query.ts` + `usecase.ts`
- [x] Wallet bounded context: application ports (IWalletReadStore, ITransactionReadStore, ILedgerEntryReadStore in `wallet/application/ports/`)
- [x] Wallet bounded context: outbound adapters (Prisma repositories, read stores, Movement repo in `wallet/infrastructure/adapters/outbound/prisma/`)
- [x] Wallet bounded context: inbound HTTP adapters (route files `wallets.routes.ts`, `transfers.routes.ts`, `holds.routes.ts` + per-endpoint handler/schemas folders in `wallet/infrastructure/adapters/inbound/http/`)
- [x] Movement entity (journal entry) for true double-entry ledger grouping
- [x] Scheduled jobs as inbound adapters: hold expiration (`wallet/infrastructure/adapters/inbound/scheduler/expireHolds.job.ts`, 30s interval) and idempotency cleanup (`common/idempotency/infrastructure/adapters/inbound/scheduler/cleanupIdempotency.job.ts`, 60s interval) — both dispatch commands via CommandBus
- [x] Concurrency audit: PlaceHold + VoidHold participate in optimistic locking
- [x] CaptureHold validates real wallet balance
- [x] Expired holds excluded from available_balance queries
- [x] Idempotency: transient error release, payload mismatch detection, method+path scoping
- [x] Architecture refactoring: `shared/` → `utils/` (toolkit) + `common/` (cross-cutting features)
- [x] CQRS bus refactoring: CommandBus/QueryBus with middleware pipeline, static TYPE for dispatch
- [x] Common: idempotency feature with full architecture (ports, command, use case, scheduler adapter, Prisma adapter)
- [x] E2E coverage for balance adjustments endpoint (`tests/e2e/wallet/adjustments.e2e.test.ts`) including success, hold-aware insufficient funds, frozen/closed states, auth, validation, idempotency, cross-tenant isolation, concurrency, and ledger assertions
- [x] Multi-currency support: explicit currency catalog (USD, EUR, MXN, CLP, KWD) with `wallets_supported_currency` CHECK constraint in PostgreSQL
- [x] Renamed all `_cents` fields to `_minor` across domain, application, infrastructure, API, and documentation to accurately reflect multi-currency minor unit semantics

## Implemented (continued)

- [x] `allow_negative_balance` per-platform flag: Platform aggregate field + DB trigger (`trg_enforce_positive_balance`) replacing CHECK constraint + `PATCH /v1/platforms/config` endpoint + available balance sign-correct readstore
- [x] `AdjustBalanceCommand` carries `allowNegativeBalance: boolean`; use case passes to domain; HTTP handler reads from HonoVariables (not AppContext)
- [x] `ImportHistoricalEntry` computes real available balance via `holdRepo.sumActiveHolds()` for negative adjustments; domain receives `allowNegativeBalance=true` to allow negative push, but hold-zombie check still runs (zombie hold = capture permanently fails because `cached < holdAmount` post-import)
- [x] E2E test suite expanded: 221 tests passing (`negative-balance.e2e.test.ts`, `config.e2e.test.ts`, third test platform seeded)
- [x] `Charge` endpoint: `POST /v1/wallets/:walletId/charge` for platform-initiated fees and commissions with optional memo
- [x] Root path redirects to `/docs` for interactive API discovery
- [x] **Distributed lock** (Redis, per-resource): `IDistributedLock` port + `LockRunner` app service + `RedisDistributedLock` adapter (ioredis, `SET NX PX` + token-aware Lua release). Wired on all 12 mutating use cases; transfer sorts+dedupes keys to avoid A↔B deadlock.
- [x] Lock feature toggle via `WALLET_LOCK_ENABLED` + `REDIS_URL`; transparent fallthrough when Redis is unreachable or the feature is off.
- [x] Transient-error classification in the acquire loop: `Command timed out` absorbed and retried within `waitMs` (slow Redis no longer silently degrades the serialization guarantee).
- [x] Pre-lock platform validation in `captureHold`/`voidHold` to prevent cross-tenant DoS via known `holdId`.
- [x] OpenAPI: 409 `LOCK_CONTENDED`/`VERSION_CONFLICT` declared on all 12 mutating endpoints.
- [x] Per-request canonical metrics for observability: `lock.attempts`, `lock.transient_errors`, `lock.token_mismatch`, `lock.acquired`, `lock.contended`, `lock.fallthrough`, `lock.duration_ms`; Redis connection lifecycle events hooked in wiring.
- [x] E2E coverage in `tests/e2e/wallet/wallet-lock.e2e.test.ts`: 50/100 concurrent deposits, cross-wallet parallelism preservation, mixed deposit/withdraw/adjust on same wallet, forced contention via external Redis holder to validate the 409 `LOCK_CONTENDED` wire path.
- [x] **System wallet sharding**: `wallets.shard_index` (NOT NULL, default 0) + `platforms.system_wallet_shard_count` (default 32, 1..1024, only-increase). FNV-1a hash routes each movement to one of N shards; `adjustSystemShardBalance` uses `UPDATE … RETURNING` for a single-statement read+write. All 6 mutation use cases updated; `findSystemWallet`/`adjustSystemWalletBalance` removed.
- [x] `ensureSystemWalletShards` is lazy + idempotent (`findMany` + `createMany(skipDuplicates)`); called outside the SERIALIZABLE tx from `CreateWalletUseCase` to avoid cross-request aborts on shard rows.
- [x] `UpdatePlatformConfig` accepts `systemWalletShardCount`; when it grows, materialises the expanded set for every currency in use on the platform. Domain enforces only-increase.
- [x] Immutable-ledger trigger `prevent_wallet_field_tampering` extended to block `UPDATE` on `shard_index`.
- [x] TransactionManager's `isRetryable` extended to match Prisma 7's `TransactionWriteConflict` class + messages; previously leaked to 500 under heavy cross-wallet load.
- [x] E2E coverage in `tests/e2e/wallet/system-wallet-sharding.e2e.test.ts`: 150 wallets × 4 concurrent deposits each (600 ops) at `>95%` success with zero 500s; ledger zero-sum invariant across all shards; lazy re-materialisation after shard delete; system shards never leak into `/v1/wallets` listing.

## What's Left to Build

- [ ] Platform bounded context: remaining platform management features (suspend, revoke, API key rotation)
- [ ] Platform API (endpoints auto-documented via hono-openapi once implemented)
- [ ] Body size limit middleware (64KB)
- [ ] Status CHECK constraints in PostgreSQL (wallets, holds, transactions, ledger_entries)
- [ ] Idempotency keys scoped by platform — UNIQUE(idempotencyKey, platformId)
- [ ] Rate limiting middleware per platformId
- [ ] Graceful shutdown (SIGTERM cleanup)
- [ ] Wallet lookup by owner endpoint — `GET /v1/wallets?owner_id=...&currency_code=...`
- [ ] Metadata field on mutation endpoints (deposit, withdraw, transfer, adjust)
- [ ] Hash chain tamper detection (ledger entries)
- [ ] Reconciliation background job (Wallet internal: cached_balance vs SUM(ledger))
- [x] Server-side retry for VERSION_CONFLICT (3 attempts + exponential backoff in PrismaTransactionManager)
- [ ] Production deploy configuration (managed PostgreSQL + Node.js process)
- [ ] Integration tests
- [x] Idempotency record TTL cleanup job (60s interval) — implemented as command dispatched via bus
- [x] API documentation (auto-generated OpenAPI + Scalar UI at /docs)
- [x] ~~System wallet contention~~ — closed by sharding (see above). Residual 409s under extreme load are expected SERIALIZABLE aborts on other rows (user wallet, transaction, ledger index), retryable by the client with the same `Idempotency-Key`.

## Known Issues

- Prisma build scripts need `pnpm approve-builds` on fresh install
- `pnpm.onlyBuiltDependencies` set in package.json for CI compatibility
