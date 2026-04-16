# Active Context — Wallet Service

## Current Focus

`allow_negative_balance` per-platform feature complete. Platforms can now configure their own instance to permit administrative adjustments (`POST /v1/wallets/:id/adjust`) that push wallet balances below zero — enabling dispute resolution, chargeback, and penalty fee workflows. The `PATCH /v1/platforms/config` endpoint allows platforms to toggle this flag using their own API key.

**allow_negative_balance feature (completed):**
- `Platform` aggregate: `allowNegativeBalance` field, getter, `setAllowNegativeBalance()` method
- Prisma schema: `allow_negative_balance BOOLEAN DEFAULT false` on `platforms` table
- DB constraint replaced: `wallets_positive_balance` CHECK removed; replaced by `trg_enforce_positive_balance` BEFORE INSERT OR UPDATE trigger that queries `platforms.allow_negative_balance` at runtime
- `apiKeyAuth` middleware: propagates `allowNegativeBalance` flag into `HonoVariables` (HTTP layer only, not AppContext)
- `AdjustBalanceCommand`: carries `allowNegativeBalance: boolean` through application layer
- `wallet.adjust()`: accepts `allowNegativeBalance` param; skips INSUFFICIENT_FUNDS guard when flag is true (system wallets always bypass)
- `wallet.readstore.ts`: removed available balance clamp (`max(0)`) — negative values now surfaced correctly in API
- `UpdatePlatformConfig`: full CQRS slice (command + usecase + handler + schemas + route) at `PATCH /v1/platforms/config`
- `ImportHistoricalEntry` use case: always passes `allowNegativeBalance=true` (privileged migration op)
- 216 E2E tests passing (including new `negative-balance.e2e.test.ts` and `config.e2e.test.ts`)
- `src/index.ts` DB safety net check updated: validates `trg_enforce_positive_balance` trigger; removed `wallets_positive_balance` constraint check

**Previously completed:**
- Hono app with middleware chain (trackingCanonical → cors → secureHeaders → requestResponseLog global; apiKeyAuth → idempotency per route group)
- Utils infrastructure: AppError, IIDGenerator (UUID v7), Logger chain (Pino -> SensitiveKeysFilter -> SafeLogger)
- CQRS bus: ICommandBus/IQueryBus interfaces (`utils/application/cqrs.ts`) and implementations (`utils/infrastructure/cqrs.ts`) with middleware pipeline
- Prisma schema with all models (Platform, Wallet, Transaction, LedgerEntry, Hold, Movement, IdempotencyRecord)
- Immutable ledger SQL (trigger + constraints)
- Wallet BC: all command use cases (createWallet, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freeze, unfreeze, close, expireHolds)
- Wallet BC: all query use cases (getWallet, getTransactions, getLedgerEntries)
- Movement entity for true double-entry ledger grouping (entries per movement sum to zero)
- Scheduled jobs as inbound adapters: hold expiration (`wallet/infrastructure/adapters/inbound/scheduler/`) and idempotency cleanup (`common/idempotency/infrastructure/adapters/inbound/scheduler/`) dispatch commands via CommandBus
- Concurrency hardening: PlaceHold + VoidHold participate in optimistic locking
- TransactionManager: Serializable isolation + internal retry (3 attempts, exponential backoff) before escalating VERSION_CONFLICT to client
- CaptureHold validates real wallet balance
- Idempotency: transient error release, payload mismatch (SHA-256 of method:path:body), endpoint scoping
- Docker Compose (PostgreSQL 16 for local dev), Dockerfile
- pnpm scripts for all workflows: `start:local`, `reset:local`, `db:update`, `dev`
- Full documentation set + concurrency audit
- AI agent instructions unified around `AGENTS.md`; `CLAUDE.md` imports it and the dedicated Cursor rule was removed to avoid duplicated guidance
- Auto-generated OpenAPI 3.1 spec (hono-openapi) + interactive Scalar UI at `/docs`
- All 13 endpoints documented with `describeRoute()` (tags, summary, response schemas)
- Dedicated e2e coverage for balance adjustments endpoint (`POST /v1/wallets/:walletId/adjust`) across auth, validation, idempotency, cross-tenant, concurrency, and ledger integrity scenarios
- Multi-currency support: explicit currency catalog (USD, EUR, MXN, CLP, KWD) with `wallets_supported_currency` CHECK constraint
- Renamed all `_cents` fields to `_minor` across domain, application, infrastructure, and API layers to accurately reflect multi-currency minor unit semantics
- Endpoint `schemas.ts` pattern: request + response Zod schemas per endpoint
- Shared `ErrorResponseSchema` in `utils/infrastructure/hono.error.ts`
- Reusable listing system: Stripe-style flat filters (`filter[field][op]=value`), dynamic multi-field sorting (`sort=-field`), keyset cursor pagination with sort signature validation
- Listing modules: `utils/kernel/listing.ts` (domain types + cursor), `utils/infrastructure/listing.zod.ts` (Zod schema factory), `utils/infrastructure/listing.prisma.ts` (Prisma query builder)
- Composite indexes for filter+sort patterns on Transaction and LedgerEntry
- Architecture refactoring: `shared/` → `utils/` (toolkit) + `common/` (cross-cutting features)
- Route files colocated with BC: `wallet/infrastructure/adapters/inbound/http/wallets.routes.ts`, `transfers.routes.ts`, `holds.routes.ts`
- Read store interfaces extracted to `wallet/application/ports/` (wallet.readstore.ts, transaction.readstore.ts, ledgerEntry.readstore.ts)
- Command/query handler files renamed from `handler.ts` to `usecase.ts`
- HTTP handlers receive `commandBus`/`queryBus` instead of individual handler instances
- Handler dispatch uses static TYPE for bus dispatch instead of constructor.name

## Temporary: Historical Import Endpoint

> **TODO(historical-import-temp)**: Remove this entire feature once all legacy consumers have completed their one-off backfill of pre-Wallet history.

`POST /v1/wallets/:walletId/import-historical-entry` creates a Transaction + Movement + paired LedgerEntries with a caller-supplied `historical_created_at` in the past, so a legacy system's journal can be replayed into the Wallet ledger preserving the original event times and human references. Semantics match `POST /:walletId/adjust` (same signed `amount_minor`, same system-wallet counterpart, same idempotency contract) — the only difference is that all journal entities get the historical timestamp instead of `Date.now()`.

- **Gate**: the endpoint is mounted behind a middleware that returns `404 NOT_FOUND` unless `HISTORICAL_IMPORT_ENABLED=true` is set on the app process. Default is off.
- **Validation**: `historical_created_at` must be a positive integer (Unix ms) strictly in the past; `reference` is required (unlike regular `adjust` where it is optional) so the imported history carries a user-facing description end-to-end.
- **Removal**: grep for `TODO(historical-import-temp)` to list every file and line that needs deleting. The marker is consistent across command, use case, handler, schemas, route registration, middleware, module wiring, tests, and docker-compose env vars.

## Next Steps

1. **Platform BC**: Implement Platform bounded context (API key management, registration)
2. **Production hardening**: Body size limit, status CHECK constraints, rate limiting, graceful shutdown
3. **Wallet lookup by owner**: `GET /v1/wallets?owner_id=...&currency_code=...` endpoint for platform integration
4. **Metadata on mutations**: Accept optional JSON metadata on deposit/withdraw/transfer/adjust
5. **Deploy**: Production configuration (managed PostgreSQL + Node.js process)
6. **Integration tests**

## Active Decisions

- **allow_negative_balance**: Per-platform flag. Flows through HonoVariables → AdjustBalanceCommand (not through AppContext, which is cross-cutting infra context only). DB enforcement via trigger (not CHECK) because triggers can reference other tables at runtime. Available balance no longer clamped to 0 in readstore. Withdraw, transfer, and holds are unaffected by the flag.

- **Amounts**: Integer in smallest currency unit per ISO 4217 (BigInt) — `_minor` suffix is convention
- **Concurrency**: Optimistic locking (version field) for ALL wallet mutations including PlaceHold/VoidHold — no SELECT FOR UPDATE in domain (see systemPatterns.md)
- **Ledger**: Double-entry via Movement entity, append-only, protected by PostgreSQL trigger. Audit invariant: `SUM(amount_minor) GROUP BY movement_id = 0`
- **Auth**: API key per platform (not user JWT)
- **DI**: Manual wiring (no DI container). All deps instantiated in `wiring.ts`, registered on CommandBus/QueryBus
- **Transactions**: Serializable isolation level; TransactionManager retries internally (3 attempts, exponential backoff 30/60/120ms) for VERSION_CONFLICT and PostgreSQL serialization failures before escalating to client
- **Hold expiration**: Two layers — query filter (`expires_at > now`) for immediate correctness + scheduled job (inbound adapter) dispatching command via bus for DB hygiene
- **CQRS dispatch**: Commands/queries dispatched via bus with middleware pipeline. Handlers registered using static TYPE field (not constructor.name)
- **Architecture split**: `utils/` = pure toolkit (no use cases), `common/` = cross-cutting features with full architecture (ports, adapters, use cases)
