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
- [x] .cursor/rules/wallet-context.mdc

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

## What's Left to Build

- [ ] Platform bounded context: domain, app, infrastructure adapters
- [ ] Platform API (endpoints auto-documented via hono-openapi once implemented)
- [ ] Rate limiting middleware
- [ ] Hash chain tamper detection (ledger entries)
- [ ] Reconciliation background job
- [x] Server-side retry for VERSION_CONFLICT (3 attempts + exponential backoff in PrismaTransactionManager)
- [ ] Production deploy configuration (managed PostgreSQL + Node.js process)
- [ ] Integration tests
- [x] Idempotency record TTL cleanup job (60s interval) — implemented as command dispatched via bus
- [x] API documentation (auto-generated OpenAPI + Scalar UI at /docs)

## Known Issues

- Prisma build scripts need `pnpm approve-builds` on fresh install
- `pnpm.onlyBuiltDependencies` set in package.json for CI compatibility
