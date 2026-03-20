# Active Context — Wallet Service

## Current Focus

Wallet bounded context fully implemented and audited. All critical concurrency bugs resolved. The service is feature-complete for the Wallet BC.

**Completed:**
- Hono app with middleware chain (tracking, logging, CORS, apiKeyAuth, idempotency)
- Shared infrastructure: AppError, IDGenerator (UUID v7), Logger chain (Pino -> SensitiveKeysFilter -> SafeLogger)
- Prisma schema with all models (Platform, Wallet, Transaction, LedgerEntry, Hold, Movement, IdempotencyRecord)
- Immutable ledger SQL (trigger + constraints)
- Wallet BC: all command handlers (create, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freeze, unfreeze, close)
- Wallet BC: all query handlers (getWallet, getTransactions, getLedgerEntries)
- Movement entity for true double-entry ledger grouping (entries per movement sum to zero)
- Hold expiration cron job (30s interval)
- Concurrency hardening: PlaceHold + VoidHold participate in optimistic locking
- CaptureHold validates real wallet balance
- Idempotency: transient error release, payload mismatch (SHA-256 of method:path:body), endpoint scoping
- Docker Compose (PostgreSQL 16 for local dev), Dockerfile
- pnpm scripts for all workflows: `start:local`, `reset:local`, `db:update`, `dev`
- Full documentation set + concurrency audit
- Auto-generated OpenAPI 3.1 spec (hono-openapi) + interactive Scalar UI at `/docs`
- All 13 endpoints documented with `describeRoute()` (tags, summary, response schemas)
- Endpoint `schemas.ts` pattern: request + response Zod schemas per endpoint
- Shared `ErrorResponseSchema` in `hono.error.ts`
- Reusable listing system: Stripe-style flat filters (`filter[field][op]=value`), dynamic multi-field sorting (`sort=-field`), keyset cursor pagination with sort signature validation
- Listing modules: `listing.ts` (domain types + cursor), `listing.zod.ts` (Zod schema factory), `listing.prisma.ts` (Prisma query builder)
- Composite indexes for filter+sort patterns on Transaction and LedgerEntry

## Next Steps

1. **Platform BC**: Implement Platform bounded context (API key management, registration)
2. **Rate limiting**: Add rate limiting middleware
3. **Idempotency cleanup**: TTL cleanup job for expired idempotency records
4. **Server-side retry**: Optional retry loop (2-3 attempts) for VERSION_CONFLICT
5. **Deploy**: Production configuration (managed PostgreSQL + Node.js process)
6. **Tests**: Integration tests

## Active Decisions

- **Amounts**: Integer in smallest currency unit per ISO 4217 (BigInt) — `_cents` suffix is convention
- **Concurrency**: Optimistic locking (version field) for ALL wallet mutations including PlaceHold/VoidHold — no SELECT FOR UPDATE in domain (see systemPatterns.md)
- **Ledger**: Double-entry via Movement entity, append-only, protected by PostgreSQL trigger. Audit invariant: `SUM(amount_cents) GROUP BY movement_id = 0`
- **Auth**: API key per platform (not user JWT)
- **DI**: Manual wiring (no DI container)
- **Hold expiration**: Two layers — query filter (`expires_at > now`) for immediate correctness + cron job for DB hygiene
