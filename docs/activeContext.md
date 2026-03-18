# Active Context — Wallet Service

## Current Focus

Phase 1 scaffolding complete. The project skeleton is set up with:

- Hono app with middleware chain (tracking, logging, CORS)
- Shared infrastructure: AppError, IDGenerator (UUID v7), Logger chain (Pino -> SensitiveKeysFilter -> SafeLogger)
- All middleware stubs: trackingCanonical, requestResponseLog, apiKeyAuth, idempotency
- Prisma schema with all models (Platform, Wallet, Transaction, LedgerEntry, Hold, IdempotencyRecord)
- Immutable ledger SQL (trigger + constraints)
- Docker Compose (PostgreSQL 16), Makefile, Dockerfile
- Full documentation set

## Next Steps

1. **Phase 2**: Implement Wallet bounded context (domain aggregates, command/query handlers, Prisma adapters, HTTP handlers)
2. **Phase 3**: Implement Platform bounded context (API key management, registration)
3. **Phase 4**: Rate limiting, hash chain tamper detection, reconciliation job
4. **Phase 5**: Deploy configuration for Vercel / Cloudflare Workers

## Active Decisions

- **Amounts**: Integer cents (BigInt) — following Stripe's convention
- **Concurrency**: Optimistic locking (version) for single-wallet ops, SELECT FOR UPDATE for transfers
- **Ledger**: Double-entry, append-only, protected by PostgreSQL trigger
- **Auth**: API key per platform (not user JWT)
- **DI**: Manual wiring (no DI container)
