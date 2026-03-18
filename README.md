# Wallet Service

Digital wallet microservice — DDD + Hexagonal + CQRS with Hono.

## Overview

Standalone backend service providing digital wallet functionality as a platform service. Other platforms integrate via REST API using API keys.

**Core features**: wallet management, deposits, withdrawals, P2P transfers, holds/authorizations, double-entry transaction ledger.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | [Hono](https://hono.dev) |
| Language | TypeScript 5+ (strict) |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Validation | Zod |
| Logging | Pino (structured JSON) |
| IDs | UUID v7 (RFC 9562) |
| Testing | Vitest |
| Linting | Biome |
| Deploy | Vercel / Cloudflare Workers |

## Architecture

- **DDD + Hexagonal + CQRS** — domain and app layers depend only on interfaces
- **Double-entry bookkeeping** — every financial operation produces exactly 2 ledger entries
- **Integer cents** — all amounts stored as BIGINT (smallest currency unit, like Stripe)
- **Immutable ledger** — `ledger_entries` is append-only (PostgreSQL trigger prevents UPDATE/DELETE)
- **Concurrency safety** — optimistic locking, SELECT FOR UPDATE, idempotency keys, DB constraints

See `docs/architecture/` for full details.

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm, Docker

# Clone and install
pnpm install

# Start PostgreSQL
make up

# Run migrations
pnpm db:push

# Apply immutable ledger constraints
# psql $DATABASE_URL -f prisma/immutable_ledger.sql

# Start dev server
make dev
```

## Development

```bash
make dev          # Start dev server with hot reload
make test         # Run tests
make lint         # Lint check
make lint-fix     # Lint fix
make fmt          # Format code
make db-generate  # Regenerate Prisma client
make db-migrate   # Run Prisma migrations
make db-studio    # Open Prisma Studio
```

## Project Structure

```
src/
├── api/              # API composition, middleware, respond helpers
│   ├── middleware/    # trackingCanonical, requestResponseLog, apiKeyAuth, idempotency
│   ├── respond/      # withError() — maps AppError to HTTP response
│   ├── wallets/      # /v1/wallets route group
│   ├── transfers/    # /v1/transfers route group
│   ├── holds/        # /v1/holds route group
│   └── platforms/    # /v1/platforms route group
├── wallet/           # Bounded context: Wallet
│   ├── domain/       # Aggregates, value objects, errors, ports
│   ├── app/          # Command and query handlers (use cases)
│   ├── adapters/     # Prisma repositories
│   └── ports/http/   # HTTP handlers
├── platform/         # Bounded context: Platform
└── shared/           # AppError, kernel (IDGenerator, context), observability (Logger)
```

## Documentation

- `docs/projectbrief.md` — Project summary
- `docs/domain.md` — Domain model and business rules
- `docs/datamodel.md` — Data model and entities
- `docs/architecture/` — Architecture, patterns, tech context, migrations
- `AGENTS.md` — AI agent instructions and conventions

## License

MIT
