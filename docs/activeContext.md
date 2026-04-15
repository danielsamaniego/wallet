# Active Context — Wallet Service

## Current Focus

Wallet bounded context fully implemented and audited. Major architectural refactoring completed: `shared/` replaced by `utils/` + `common/`, `src/api/` eliminated (routes colocated with BC), `src/jobs/` replaced by scheduled jobs as inbound adapters dispatching commands via bus. CQRS bus (CommandBus/QueryBus) with middleware pipeline fully operational.

**Completed:**
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

## Next Steps

1. **Platform BC**: Implement Platform bounded context (API key management, registration)
2. **Rate limiting**: Add rate limiting middleware
3. **Deploy**: Production configuration (managed PostgreSQL + Node.js process)
4. **Tests**: Integration tests

## Active Decisions

- **Amounts**: Integer in smallest currency unit per ISO 4217 (BigInt) — `_minor` suffix is convention
- **Concurrency**: Optimistic locking (version field) for ALL wallet mutations including PlaceHold/VoidHold — no SELECT FOR UPDATE in domain (see systemPatterns.md)
- **Ledger**: Double-entry via Movement entity, append-only, protected by PostgreSQL trigger. Audit invariant: `SUM(amount_minor) GROUP BY movement_id = 0`
- **Auth**: API key per platform (not user JWT)
- **DI**: Manual wiring (no DI container). All deps instantiated in `wiring.ts`, registered on CommandBus/QueryBus
- **Transactions**: Serializable isolation level; TransactionManager retries internally (3 attempts, exponential backoff 30/60/120ms) for VERSION_CONFLICT and PostgreSQL serialization failures before escalating to client
- **Hold expiration**: Two layers — query filter (`expires_at > now`) for immediate correctness + scheduled job (inbound adapter) dispatching command via bus for DB hygiene
- **CQRS dispatch**: Commands/queries dispatched via bus with middleware pipeline. Handlers registered using static TYPE field (not constructor.name)
- **Architecture split**: `utils/` = pure toolkit (no use cases), `common/` = cross-cutting features with full architecture (ports, adapters, use cases)
