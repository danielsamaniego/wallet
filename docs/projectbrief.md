# Project Brief — Wallet Service

## What We Are Building

**Wallet Service** is a standalone backend microservice that provides digital wallet functionality as a service. Other platforms (e-commerce, fintech apps, marketplaces) integrate via REST API using API keys. The service manages wallets, deposits, withdrawals, P2P transfers, holds/authorizations, and an immutable transaction ledger.

## Scope

- **Platform type**: Backend microservice — no UI; API-only
- **Framework**: Hono (TypeScript) — fast, lightweight HTTP
- **Database**: PostgreSQL with Prisma ORM
- **Distributed lock** (optional): Redis (ioredis) for per-wallet write serialization; feature-toggled via `WALLET_LOCK_ENABLED`
- **Architecture**: DDD + Hexagonal + CQRS (with CommandBus/QueryBus dispatch)
- **Integration**: REST API; platforms authenticate with API keys
- **Deployment**: Plain Node.js process + managed PostgreSQL (no Docker in production). Redis is optional in prod; if absent, the lock falls through and optimistic locking takes over.

## Key Features

- **Wallet management**: Create wallets per owner/platform/currency, freeze/unfreeze, close
- **Deposits**: Credit funds (counterparty: system wallet)
- **Withdrawals**: Debit funds (counterparty: system wallet)
- **P2P transfers**: Move funds between two user wallets atomically
- **Holds/authorizations**: Reserve funds without moving; capture, void, or expire
- **Transaction ledger**: Double-entry, append-only, immutable audit trail
- **Idempotency**: Safe retries for mutations via idempotency keys
- **Race-condition protection**: Two-layer concurrency — outer Redis-backed `LockRunner` (per-resource mutex, feature-toggled) + inner optimistic locking (version field) with TransactionManager retries. Plus idempotency keys and DB constraints as safety nets.

## Technical Conventions

| Aspect | Choice |
|--------|--------|
| Amounts | Integer minor units (BIGINT) — Stripe-style; no floating point. Supported currencies: USD, EUR, MXN, CLP, KWD |
| Ledger | Double-entry bookkeeping — every operation produces debit + credit |
| IDs | UUID v7 (time-ordered), generated in application code |
| Timestamps | Unix ms (BIGINT) everywhere |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |
| Linting/formatting | Biome |

## Architecture Overview

- **`utils/`** — Pure toolkit: kernel (domain-safe abstractions), application interfaces (CQRS bus, IIDGenerator), infrastructure implementations, HTTP middlewares
- **`common/`** — Cross-cutting features with full architecture (ports, adapters, use cases). Currently: idempotency feature
- **`wallet/`** — Wallet bounded context: domain, application (commands + queries dispatched via bus), infrastructure adapters (inbound HTTP + scheduler, outbound Prisma)
- **Scheduled jobs** are inbound adapters dispatching commands via CommandBus (same pattern as HTTP routes)

## Deep Context

For full domain, flows, and business rules: **[domain.md](domain.md)**

For entities and data structures: **[datamodel.md](datamodel.md)**

## Current Phase

Service under development. Core wallet, transaction, ledger, and hold models fully implemented. Architecture aligned with DDD + Hexagonal + CQRS patterns. Platform BC planned but not yet implemented.
