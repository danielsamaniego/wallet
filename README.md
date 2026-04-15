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
| ORM | Prisma 7 |
| Validation | Zod |
| API docs | hono-openapi + @scalar/hono-api-reference |
| Logging | Pino (structured JSON) |
| IDs | UUID v7 (RFC 9562) |
| Testing | Vitest |
| Linting | Biome |

## Architecture

- **DDD + Hexagonal + CQRS** — domain and app layers depend only on interfaces
- **CQRS bus** — commands/queries dispatched via ICommandBus/IQueryBus with middleware pipeline
- **Double-entry bookkeeping** — every financial operation produces exactly 2 ledger entries
- **Integer cents** — all amounts stored as BIGINT (smallest currency unit, like Stripe)
- **Immutable ledger** — `ledger_entries` is append-only (PostgreSQL trigger prevents UPDATE/DELETE)
- **Concurrency safety** — optimistic locking, idempotency keys, DB constraints

- **Auto-generated API docs** — OpenAPI 3.1 spec at `/openapi`, interactive Scalar UI at `/docs`
- **Stripe-style listing** — flat filters, dynamic multi-field sorting, keyset cursor pagination

See `docs/architecture/` for full details.

---

## Local Development

**Prerequisites:** Node.js 22+, pnpm, Docker

### Option A: Everything in Docker (recommended)

One command — starts PostgreSQL + App with hot reload, applies schema, constraints, and seed:

```bash
pnpm install          # First time only
pnpm dev:docker       # PostgreSQL :5432 + App :3000 (hot reload)
```

```bash
pnpm dev:docker:logs  # Tail app logs
pnpm dev:docker:down  # Stop everything
```

### Option B: Only DB in Docker, server local

```bash
pnpm install          # First time only
pnpm start:local      # Docker PostgreSQL + schema + constraints + seed
pnpm dev              # tsx watch on http://localhost:3000
```

### Reset (wipe all data and start fresh)

```bash
pnpm dev:docker:reset # Full Docker reset (down -v + dev:docker)
pnpm reset:local      # Docker DB only reset (down -v + start:local)
```

### Schema or constraint changes

```bash
pnpm db:update        # Push schema → apply constraints → regenerate Prisma client
```

### Build

```bash
pnpm build            # tsc → dist/
pnpm start            # node dist/index.js (requires DB running)
```

Docker production image:

```bash
docker build -t wallet-app .
docker run -p 3000:3000 -e DATABASE_URL=postgresql://... wallet-app
```

---

## Testing

**670 tests, 100% coverage, BDD style (Given/When/Then).**

| Command | What | Time | Docker? |
|---------|------|------|---------|
| `pnpm test` | 581 unit tests | ~2s | No |
| `pnpm test:watch` | Unit tests in watch mode | — | No |
| `pnpm test:e2e` | 89 e2e tests (auto-starts Docker) | ~38s | Auto |
| `pnpm test:coverage` | Unit tests + 100% coverage enforced | ~3s | No |
| `pnpm test:all` | Unit → E2E sequentially | ~40s | Auto |

E2E tests are fully self-contained — `pnpm test:e2e` starts isolated Docker containers (PostgreSQL `:5433`, App `:3333`), runs tests, and stops them. Dev containers are never touched.

### Docker isolation

| | Dev | Test | Production |
|---|---|---|---|
| **Compose** | `docker-compose.dev.yml` | `docker-compose.test.yml` | `Dockerfile` |
| **Project** | `wallet-dev` | `wallet-test` | — |
| **PostgreSQL** | `:5432` / `wallet` | `:5433` / `wallet_test` | Managed DB |
| **App** | `:3000` (hot reload) | `:3333` (built) | `:3000` (built) |

### Test documentation

See `test/docs/` for AI agent and developer testing guides:

- `TESTING_GUIDE.md` — Master guide (TDD workflow, 100% coverage rules, structure)
- `BDD_STYLE_GUIDE.md` — Given/When/Then naming conventions
- `E2E_TEST_PATTERNS.md` — 12 security categories, Docker setup, copy-paste templates
- `DOMAIN_TEST_PATTERNS.md` — Domain entity test templates
- `USECASE_TEST_PATTERNS.md` — Use case test templates with mocks
- `MOCK_CATALOG.md` — All available mocks, builders, matchers

---

## All Scripts

```bash
# Development
pnpm dev              # Local server with hot reload (requires DB running)
pnpm dev:docker       # Full Docker dev (PostgreSQL + App with hot reload)
pnpm dev:docker:reset # Nuclear Docker dev reset (down -v + dev:docker)
pnpm dev:docker:down  # Stop Docker dev environment
pnpm dev:docker:logs  # Tail app logs

# Build
pnpm build            # Compile TypeScript → dist/
pnpm start            # Run compiled output (node dist/index.js)

# Testing
pnpm test             # Unit tests
pnpm test:watch       # Unit tests in watch mode
pnpm test:e2e         # E2E tests (Docker auto-start/stop)
pnpm test:coverage    # Unit tests with 100% coverage enforcement
pnpm test:all         # Unit → E2E sequentially

# Code quality
pnpm lint             # Lint check (Biome)
pnpm lint:fix         # Lint fix
pnpm fmt              # Format code (Biome)

# Docker (DB only)
pnpm docker:up        # Start PostgreSQL container
pnpm docker:down      # Stop PostgreSQL container
pnpm docker:logs      # Tail container logs
pnpm docker:wait      # Wait until PostgreSQL is ready

# Database
pnpm db:push          # Sync schema.prisma → database
pnpm db:migrate       # Create and apply Prisma migration
pnpm db:generate      # Regenerate Prisma client
pnpm db:seed          # Seed test platform + API key
pnpm db:constraints   # Apply immutable ledger constraints
pnpm db:update        # db:push + db:constraints + db:generate
pnpm db:studio        # Open Prisma Studio GUI

# Composite
pnpm start:local      # Docker PostgreSQL + schema + constraints + seed
pnpm reset:local      # Nuclear reset (docker down -v + start:local)
```

---

## Production Deployment

Production runs as a plain Node.js process against a managed PostgreSQL instance (Neon, Supabase, AWS RDS, etc.). **No Docker.**

### Environment variables

```bash
DATABASE_URL=postgresql://user:pass@host:5432/wallet?schema=public
HTTP_PORT=3000
LOG_LEVEL=info
```

### Deploy steps

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Generate Prisma client
pnpm db:generate

# 3. Apply pending migrations
prisma migrate deploy --config prisma/prisma.config.ts

# 4. Apply immutable ledger constraints
psql $DATABASE_URL -f prisma/immutable_ledger.sql

# 5. Build
pnpm build

# 6. Start
pnpm start   # node dist/index.js
```

### CI/CD pipeline (typical)

1. `pnpm install --frozen-lockfile`
2. `pnpm lint && pnpm test`
3. `pnpm build`
4. `prisma migrate deploy --config prisma/prisma.config.ts`
5. `psql $DATABASE_URL -f prisma/immutable_ledger.sql`
6. Deploy artifact / restart process

### Production rules

- **Never** run `db:push` in production — use `prisma migrate deploy` only
- **Never** auto-migrate at app startup — run migrations as a separate deploy step
- **Never** run seed in production
- Apply `immutable_ledger.sql` after every migration that touches `ledger_entries`, `wallets`, `holds`, or `transactions`
- The app verifies triggers and constraints exist on startup — it will refuse to start if missing

---

## Project Structure

```
src/
├── common/                          # Cross-cutting features with full architecture (NOT a bounded context)
│   └── idempotency/                 # Idempotency feature (cleanup job, store port, Prisma adapter)
├── utils/                           # Pure toolkit, zero use cases
│   ├── kernel/                      # Domain-safe abstractions (NO infra deps)
│   ├── application/                 # Application-level interfaces (CQRS bus, IIDGenerator, ITransactionManager)
│   ├── infrastructure/              # Infra implementations (CommandBus, QueryBus, Hono helpers, Prisma adapters)
│   └── middleware/                   # HTTP middlewares (apiKeyAuth, idempotency, logging, tracking)
├── wallet/                          # Bounded context: Wallet
│   ├── domain/                      # Aggregates, value objects, errors, repository ports
│   ├── application/                 # Command/query use cases + read store ports
│   └── infrastructure/adapters/     # Inbound (HTTP routes, scheduler jobs) + Outbound (Prisma repos)
├── index.ts                         # App bootstrap, global middleware, onError, route mounting
├── wiring.ts                        # DI: repos, use cases, bus registration — instantiated once
└── config.ts                        # Environment variables
```

## API Documentation

Start the server and visit **http://localhost:3000/docs** for the interactive Scalar API reference. The OpenAPI 3.1 JSON spec is available at **/openapi**.

Documentation is auto-generated from Zod schemas and `describeRoute()` metadata in each handler — no manual API docs to maintain.

## Documentation

- `docs/projectbrief.md` — Project summary
- `docs/domain.md` — Domain model and business rules
- `docs/datamodel.md` — Data model and entities
- `docs/architecture/` — Architecture, patterns, tech context, migrations
- `AGENTS.md` — AI agent instructions and conventions
- `CLAUDE.md` — Claude Code wrapper that imports `AGENTS.md`

## License

MIT
