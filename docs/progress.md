# Progress — Wallet Service

## What Works

- [x] Project initialized (pnpm, TypeScript strict, Biome, Vitest)
- [x] Docker Compose (PostgreSQL 16)
- [x] Dockerfile (multi-stage Node.js)
- [x] Makefile (dev, test, lint, db commands)
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
- [x] API: respond/error.ts (withError — maps AppError to HTTP response)
- [x] Prisma schema (all models)
- [x] Immutable ledger SQL (trigger + constraints)
- [x] Hono app with health endpoint and middleware chain
- [x] Config from env vars
- [x] Manual DI wiring
- [x] Full documentation set
- [x] AGENTS.md
- [x] .cursor/rules/wallet-context.mdc

## What's Left to Build

- [ ] Wallet bounded context: domain (aggregate, value objects, errors)
- [ ] Wallet bounded context: app (command handlers: create, deposit, withdraw, transfer, hold, capture, void, freeze, close)
- [ ] Wallet bounded context: app (query handlers: getWallet, getTransactions, getLedgerEntries)
- [ ] Wallet bounded context: adapters (Prisma repositories, read stores)
- [ ] Wallet bounded context: ports/http (all endpoint handlers + DTOs)
- [ ] Wallet API documentation (API.md)
- [ ] Platform bounded context: domain, app, adapters, ports/http
- [ ] Platform API documentation (API.md)
- [ ] Rate limiting middleware
- [ ] Hash chain tamper detection (ledger entries)
- [ ] Reconciliation background job
- [ ] Hold expiration background job
- [ ] Vercel / Cloudflare deploy configuration
- [ ] Integration tests
- [ ] API overview (src/api/API.md)

## Known Issues

- Prisma build scripts need `pnpm approve-builds` on fresh install
- `pnpm.onlyBuiltDependencies` set in package.json for CI compatibility
