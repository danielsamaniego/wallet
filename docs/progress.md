# Progress — Wallet Service

## What Works

- [x] Project initialized (pnpm, TypeScript strict, Biome, Vitest)
- [x] Docker Compose (PostgreSQL 16 for local dev)
- [x] Dockerfile (multi-stage Node.js)
- [x] pnpm scripts for all workflows (`start:local`, `reset:local`, `db:update`, etc.)
- [x] Shared: AppError (Kind + Code + Message)
- [x] Shared: IDGenerator interface + UUID v7 adapter
- [x] Shared: AppContext + createAppContext factory + HonoVariables types
- [x] Shared: Logger interface with canonical log support
- [x] Shared: SafeLogger (never throws)
- [x] Shared: SensitiveKeysFilter (omits sensitive keys)
- [x] Shared: CanonicalAccumulator (request-scoped meta + counters)
- [x] Shared: PinoAdapter (structured JSON logging with context fields)
- [x] Middleware: trackingCanonical (tracking_id UUID v7 + canonical dispatch)
- [x] Middleware: requestResponseLog (request/response logging)
- [x] Middleware: apiKeyAuth (API key validation)
- [x] Middleware: idempotency (duplicate prevention)
- [x] Error handling: errorResponse + httpStatus + validationHook (shared/adapters/kernel/hono.error.ts)
- [x] Global onError handler (maps AppError → HTTP status, catches unhandled exceptions)
- [x] Prisma schema (all models)
- [x] Immutable ledger SQL (trigger + constraints)
- [x] Hono app with health endpoint, secureHeaders, notFound, basePath("/v1"), route() sub-apps
- [x] Config from env vars
- [x] Centralized DI wiring (repos + app handlers instantiated once in wiring.ts)
- [x] HTTP handlers using handlerFactory.createHandlers() with zValidator (type-safe, no try/catch)
- [x] Tracking middleware supports external X-Tracking-Id header (ext- prefix)
- [x] Full documentation set
- [x] AGENTS.md
- [x] .cursor/rules/wallet-context.mdc

## Implemented

- [x] Wallet bounded context: domain (aggregate, value objects, errors, Movement entity)
- [x] Wallet bounded context: app (command handlers: create, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freeze, unfreeze, close)
- [x] Wallet bounded context: app (query handlers: getWallet, getTransactions, getLedgerEntries)
- [x] Wallet bounded context: adapters (Prisma repositories, read stores, Movement repo)
- [x] Wallet bounded context: ports/http (all endpoint handlers + DTOs)
- [x] Movement entity (journal entry) for true double-entry ledger grouping
- [x] Hold expiration background job (30s interval, marks zombie holds as 'expired'; queries also filter by expires_at as defense in depth)
- [x] Concurrency audit: PlaceHold + VoidHold participate in optimistic locking
- [x] CaptureHold validates real wallet balance
- [x] Expired holds excluded from available_balance queries
- [x] Idempotency: transient error release, payload mismatch detection, method+path scoping

## What's Left to Build

- [ ] Platform bounded context: domain, app, adapters, ports/http
- [ ] Platform API documentation (API.md)
- [ ] Rate limiting middleware
- [ ] Hash chain tamper detection (ledger entries)
- [ ] Reconciliation background job
- [x] Idempotency record TTL cleanup job (60s interval)
- [ ] Server-side retry for VERSION_CONFLICT (2-3 attempts)
- [ ] Production deploy configuration (managed PostgreSQL + Node.js process)
- [ ] Integration tests
- [ ] API overview (src/api/API.md)

## Known Issues

- Prisma build scripts need `pnpm approve-builds` on fresh install
- `pnpm.onlyBuiltDependencies` set in package.json for CI compatibility
