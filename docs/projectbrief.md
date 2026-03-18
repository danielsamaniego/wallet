# Project Brief — Wallet Service

## What We Are Building

**Wallet Service** is a standalone backend microservice that provides digital wallet functionality as a service. Other platforms (e-commerce, fintech apps, marketplaces) integrate via REST API using API keys. The service manages wallets, deposits, withdrawals, P2P transfers, holds/authorizations, and an immutable transaction ledger.

## Scope

- **Platform type**: Backend microservice — no UI; API-only
- **Framework**: Hono (TypeScript) — fast, lightweight HTTP
- **Database**: PostgreSQL with Prisma ORM
- **Architecture**: DDD + Hexagonal + CQRS
- **Integration**: REST API; platforms authenticate with API keys
- **Deployment**: Vercel / Cloudflare serverless, or containerized (Docker)

## Key Features

- **Wallet management**: Create wallets per owner/platform/currency, freeze/unfreeze, close
- **Deposits**: Credit funds (counterparty: system wallet)
- **Withdrawals**: Debit funds (counterparty: system wallet)
- **P2P transfers**: Move funds between two user wallets atomically
- **Holds/authorizations**: Reserve funds without moving; capture, void, or expire
- **Transaction ledger**: Double-entry, append-only, immutable audit trail
- **Idempotency**: Safe retries for mutations via idempotency keys
- **Race-condition protection**: Optimistic locking (version field), idempotency keys, DB constraints

## Technical Conventions

| Aspect | Choice |
|--------|--------|
| Amounts | Integer cents (BIGINT) — Stripe-style; no floating point |
| Ledger | Double-entry bookkeeping — every operation produces debit + credit |
| IDs | UUID v7 (time-ordered), generated in application code |
| Timestamps | Unix ms (BIGINT) everywhere |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |
| Linting/formatting | Biome |

## Deep Context

For full domain, flows, and business rules: **[domain.md](domain.md)**

For entities and data structures: **[datamodel.md](datamodel.md)**

## Current Phase

Service under development. Core wallet, transaction, ledger, and hold models defined. Architecture aligned with DDD + Hexagonal + CQRS patterns.
