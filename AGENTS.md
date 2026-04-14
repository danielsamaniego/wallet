# Wallet Service — Agent Instructions

Instructions for AI coding agents (Cursor, Codex, etc.) working on the Wallet Service.

---

## Context Loading (Critical)

**At the start of any task**, read the relevant files from `docs/` before implementing:

- **Domain, business rules, or data**: Read `docs/domain.md`, `docs/datamodel.md`
- **Backend, API, or architecture**: Read `docs/architecture/techContext.md`, `docs/architecture/backend-architecture.md`, `docs/architecture/systemPatterns.md`
- **Database or migrations**: Read `docs/architecture/database-migrations.md`
- **General orientation**: Read `docs/projectbrief.md`

Use the file paths above. Do not proceed without loading the relevant context first.

---

## Required Reading

Before implementing domain logic, business rules, or data structures:

- **[docs/domain.md](docs/domain.md)** — Domain model, actors, flows, and business rules
- **[docs/datamodel.md](docs/datamodel.md)** — Entities, relationships, and conceptual data model
- **[docs/projectbrief.md](docs/projectbrief.md)** — High-level summary
- **[docs/architecture/techContext.md](docs/architecture/techContext.md)** — Stack, dependencies, setup
- **[docs/architecture/systemPatterns.md](docs/architecture/systemPatterns.md)** — Architecture patterns
- **[docs/architecture/backend-architecture.md](docs/architecture/backend-architecture.md)** — Backend DDD + Hexagonal + CQRS layout
- **[docs/architecture/database-migrations.md](docs/architecture/database-migrations.md)** — Migrations (Prisma, UUID v7, immutable ledger)

---

## Project Overview

**Wallet Service** is a standalone digital wallet microservice. Platforms integrate via REST API using API keys. Provides wallet management, deposits, withdrawals, P2P transfers, holds/authorizations, and a double-entry transaction ledger. Built with Hono (TypeScript), PostgreSQL, Prisma.

---

## Conventions

| Aspect | Rule |
|--------|------|
| **Code & comments** | English |
| **Documentation** | English |
| **Responses** | Always Spanish |
| **Credentials** | Never hardcode; use environment variables |
| **Timestamps** | Unix ms (number) everywhere: DB (BigInt), domain, ports, DTOs, API. Single representation, no conversion. |
| **Amounts** | **Integer cents (BigInt).** All financial amounts are the smallest currency unit. `$1.99` = `199`. Never float, never decimal. API sends/receives `amount_cents: number`. |
| **Entity IDs** | **UUID v7 only, generated in code.** App generates all IDs via `IIDGenerator`; DB never generates them. Never UUID v4. |
| **API** | REST. All mutations require `Idempotency-Key` header. |
| **Domain and app** | **No external third-party libraries.** No Prisma, Pino, uuidv7, Zod, Hono in domain or app. Allowed: TypeScript stdlib, interfaces (ports), and `utils/kernel/` only. Never import from `utils/infrastructure/` or `utils/middleware/` in domain or app layers — that's an architecture violation. Third-party libs live only in **adapters**. |
| **CQRS** | Commands (write) and Queries (read) are separate. Commands may return minimal data (created ID) — never full aggregates or rich DTOs. **No Event Sourcing** (ledger_entries is the audit trail). **No Event-Driven** (BCs communicate synchronously). Commands and queries are dispatched via `ICommandBus` / `IQueryBus`. See `backend-architecture.md` § CQRS. |
| **CQRS file structure** | Each command use case has **two files**: `command.ts` (pure types: command + result interfaces) and `usecase.ts` (use case/handler class). Each query has `query.ts` (query + DTO types) and `usecase.ts`. ReadStore interfaces live in `wallet/application/ports/`. This separates the contract from the implementation. |
| **Queries** | Use ReadStore ports (return DTOs directly). Do not load aggregates for reads. ReadStore interfaces are in `wallet/application/ports/` (e.g., `wallet.readstore.ts`). |
| **Logging** | Use `ILogger` (port); wired as PinoAdapter → SensitiveKeysFilter → SafeLogger. mainLogTag per file, methodLogTag per method; every message starts with methodLogTag. **Production goal: full traceability** — every request must be reconstructable from logs alone. `debug`: handler entry with params, intermediate values, adapter calls, tx begin/commit/rollback. `info`: business operation success, noteworthy domain events. `warn`: client errors (validation, malformed JSON), optimistic locking conflicts. `error`: server-side failures (5xx), infrastructure errors. `fatal`: process must shut down. Always log handler entry (`debug`) and success (`info`). Always log early returns. Adapter methods log every DB call (`debug`). Client errors are `warn`, not `error`. See `docs/architecture/backend-architecture.md` § Logging. |
| **Error handling** | Use `AppError` (Kind + Code + Message). Domain: factory functions returning `AppError`. App: sentinel errors as `AppError`. Handlers throw; the global `onError` in `index.ts` catches `AppError`, maps Kind → HTTP status via `httpStatus()`, and returns `errorResponse(c, code, msg, status)` → `{"error": "CODE", "message": "..."}`. Middleware uses `errorResponse()` directly. Both use `utils/infrastructure/hono.error.ts`. Every error needs a unique UPPER_SNAKE_CASE Code. |
| **Naming: interfaces** | All interfaces start with `I` prefix: `IWalletRepository`, `ILogger`, `IIDGenerator`, `ITransactionManager`, `IWalletReadStore`, etc. Class implementations do NOT have the prefix: `PrismaWalletRepo`, `SafeLogger`, `UUIDV7Generator`. Use case classes are named `XUseCase` (e.g., `DepositUseCase`, `GetWalletUseCase`), not `XHandler`. |
| **Naming: files** | Dotted suffix convention: `wallet.aggregate.ts`, `hold.entity.ts`, `wallet.errors.ts`, `wallet.repository.ts` (port), `wallet.repo.ts` (adapter), `wallet.readstore.ts`, `transaction.manager.ts`, `idempotency.store.ts`, `logger.port.ts`, `sensitive.filter.ts`, `id.generator.ts`. Command/query types: `command.ts` / `query.ts`. Use case classes: `usecase.ts`. |
| **Struct ordering** | Constructor (static `create`/factory) goes immediately after the class definition, before methods. Order: class → constructor/factory → methods. |
| **API documentation** | **Auto-generated via hono-openapi + Scalar.** `/openapi` serves the OpenAPI 3.1 JSON spec; `/docs` serves the interactive Scalar UI. Documentation is derived from Zod schemas and `describeRoute()` metadata — never write API docs manually. |
| **API endpoint checklist** | When adding or modifying an endpoint: **(1)** Define request schemas (`ParamSchema`, `BodySchema`, `QueryParamsSchema`) and `ResponseSchema` in `schemas.ts`. **(2)** Add `describeRoute({ tags, summary, responses })` with `resolver(ResponseSchema)` and `resolver(ErrorResponseSchema)` in the handler. **(3)** Use `validator` from `hono-openapi` (aliased as `zValidator`), not `@hono/zod-validator`. **(4)** Register the route in the routes file (e.g., `wallets.routes.ts`). The OpenAPI spec updates automatically. |
| **Concurrency** | All wallet mutations: optimistic locking (`version` field). TransactionManager retries internally (3 attempts, exponential backoff) under **Serializable isolation**; if exhausted → `409 VERSION_CONFLICT`, client retries with same idempotency key. No `SELECT FOR UPDATE` in domain ports (infrastructure leak — see `systemPatterns.md`). All mutations: idempotency keys with atomic acquire pattern. Safety net: DB `CHECK` constraints. |
| **TransactionManager** | Use `txManager.run()` only when the use case performs **multiple writes that must be atomic** (e.g., deposit: wallet + transaction + ledger entries). Use cases with a single idempotent write (e.g., `ExpireHoldsUseCase`) or read-only queries do **not** need a transaction wrapper. |
| **Global middleware chain** | Order in `index.ts`: `trackingCanonical` → `cors` (hono/cors) → `secureHeaders` (hono/secure-headers) → `requestResponseLog`. Then per route group: `apiKeyAuth` → `idempotency` (mutations only). |
| **Route mounting** | `index.ts` uses `app.basePath("/v1")` to create a versioned sub-router. Route groups are mounted with `v1.route("/wallets", walletRoutes(deps))`. The `/v1` prefix is set once; route files must **not** repeat it. Health check (`/health`) and docs (`/openapi`, `/docs`) live outside `/v1`. |
| **Ledger** | Double-entry bookkeeping. Every financial op produces exactly 2 LedgerEntry records (debit + credit). `ledger_entries` is **immutable** (append-only): never UPDATE, never DELETE. Protected by PostgreSQL trigger. |
| **BigInt serialization** | Prisma BigInt → use `utils/kernel/bigint.ts` (`toSafeNumber`, `toNumber`, `bigIntReplacer`). Never expose raw `bigint` in API responses. |
| **AppContext** | Use `buildAppContext(c)` from `utils/infrastructure/hono.context.ts` in HTTP handlers. For non-HTTP flows (jobs, scripts, tests), use `createAppContext(idGen)` from `utils/kernel/context.ts`. Never build `AppContext` manually with `c.get()`. |
| **HTTP handlers** | Use `handlerFactory.createHandlers()` from `utils/infrastructure/hono.context.ts`. Each endpoint folder has `schemas.ts` (Zod request + response schemas) and `handler.ts` (imports schemas, adds `describeRoute()` + validators + handler). No try/catch — errors propagate to the global `onError`. Route files receive `commandBus`/`queryBus` and only do routing. |
| **Outbound ports convention** | All outbound port methods (repositories, read stores, transaction manager) receive `ctx: AppContext` as their **first parameter**. Adapters typically receive `ILogger` in their constructor for traceability. Exception: adapters like `PrismaIdempotencyStore` may receive `IIDGenerator` instead — the constructor signature depends on the adapter's needs, not a rigid rule. |
| **Currency** | `currency_code` must be valid ISO 4217 uppercase. Cross-currency transfers not allowed. |
| **System wallets** | One per (platform, currency), `owner_id = "SYSTEM"`, `is_system = true`. Auto-created on first wallet creation for that platform/currency. Cannot be frozen or closed. |
| **Scheduled jobs** | Cron jobs are **inbound adapters** (same category as HTTP routes). The scheduler dispatches commands via the `CommandBus`. Each BC or common feature defines its jobs in `infrastructure/adapters/inbound/scheduler/`. |

---

## Stack

- **Framework:** Hono — REST API
- **Language:** TypeScript 5+ (strict mode)
- **Runtime:** Node.js 22+
- **ORM:** Prisma 7 (PostgreSQL)
- **Database:** PostgreSQL 16
- **Validation:** Zod (request/response schemas) + hono-openapi (OpenAPI generation + validator)
- **API docs:** hono-openapi + @scalar/hono-api-reference (auto-generated from Zod schemas)
- **UUID:** uuidv7 (RFC 9562)
- **Logging:** Pino (structured JSON)
- **Testing:** Vitest
- **Linting:** Biome
- **Package manager:** pnpm
- **Local DB:** Docker Compose (PostgreSQL container)
- **Production:** Plain Node.js process + managed PostgreSQL (no Docker)

---

## Directory Structure

| Path | Description |
|------|-------------|
| `src/` | Application source code |
| `src/common/` | Cross-cutting features with full architecture (ports, adapters, use cases). NOT a bounded context. Currently: idempotency feature (cleanup job, store port, Prisma adapter). |
| `src/utils/` | Pure toolkit — reusable utilities that are NOT features. Zero use cases. |
| `src/utils/kernel/` | Domain-safe abstractions (NO infra deps). Equivalent to domain+application pragmatically. Contains: `appError.ts`, `context.ts` (AppContext, createAppContext), `bigint.ts`, `listing.ts`, `observability/` (ILogger port, CanonicalAccumulator). |
| `src/utils/application/` | Application-level interfaces: `cqrs.ts` (ICommandBus, IQueryBus, ICommand, IQuery, etc.), `id.generator.ts` (IIDGenerator), `transaction.manager.ts` (ITransactionManager). |
| `src/utils/infrastructure/` | Infra implementations: `cqrs.ts` (CommandBus, QueryBus), `hono.context.ts` (HonoVariables, buildAppContext, handlerFactory), `hono.error.ts` (errorResponse, validationHook, ErrorResponseSchema), `listing.zod.ts`, `listing.prisma.ts`, `prisma.transaction.manager.ts`, `scheduler.ts` (startScheduledJobs), `uuidV7.ts`, `observability/` (PinoAdapter, SafeLogger, SensitiveKeysFilter). |
| `src/utils/middleware/` | All HTTP middlewares: `apiKeyAuth.ts`, `idempotency.ts`, `requestResponseLog.ts`, `trackingCanonical.ts`. |
| `src/wallet/` | Bounded context: Wallet (wallets, transactions, ledger, holds) |
| `src/wallet/domain/ports/` | Write repository interfaces (IWalletRepository, IHoldRepository, etc.) |
| `src/wallet/application/ports/` | Read store interfaces (IWalletReadStore, ITransactionReadStore, ILedgerEntryReadStore) |
| `src/wallet/application/command/` | 11 commands, each with `command.ts` + `usecase.ts` |
| `src/wallet/application/query/` | 3 queries, each with `query.ts` + `usecase.ts` |
| `src/wallet/infrastructure/adapters/inbound/http/` | Route files (`wallets.routes.ts`, `transfers.routes.ts`, `holds.routes.ts`) + per-endpoint folders (`schemas.ts` + `handler.ts`) |
| `src/wallet/infrastructure/adapters/inbound/scheduler/` | Wallet-specific scheduled jobs (`expireHolds.job.ts`, `jobs.ts`) |
| `src/wallet/infrastructure/adapters/outbound/prisma/` | Prisma repository and read store implementations |
| `prisma/` | Prisma schema and migrations |
| `prisma/immutable_ledger.sql` | PostgreSQL trigger + constraints for append-only ledger |
| `docs/` | Domain, data model, architecture documentation |

---

## Workflow Tips

1. **Domain changes**: Update `docs/domain.md` and `docs/datamodel.md` before or with code.
2. **Progress**: Update `docs/activeContext.md` and `docs/progress.md` after significant work.
3. **Architecture**: Follow `docs/architecture/backend-architecture.md` and `docs/architecture/systemPatterns.md`. Domain and app depend only on interfaces.
4. **Migrations**: Use Prisma Migrate; see `docs/architecture/database-migrations.md`. Locally: `pnpm db:update`. Production: `prisma migrate deploy` then `psql $DATABASE_URL -f prisma/immutable_ledger.sql`.
5. **New endpoint**: Create `schemas.ts` (request + response schemas) → create `handler.ts` (with `describeRoute()` + validators) → register in the appropriate routes file (e.g., `wallets.routes.ts`). The OpenAPI spec at `/openapi` and Scalar UI at `/docs` update automatically.
6. **Before every commit**: Run `pnpm test` and `pnpm test:e2e`. Both suites must pass at 100% with zero failures. Never commit with broken tests.

---

## Testing (MANDATORY — Read Before Any Code Change)

> **Every code change MUST include tests. No exceptions.**
> Think TDD: write (or update) the test FIRST, see it fail, then implement.

### Required reading before writing tests

- `test/docs/TESTING_GUIDE.md` — Master guide, structure, commands
- `test/docs/BDD_STYLE_GUIDE.md` — Given/When/Then convention
- `test/docs/DOMAIN_TEST_PATTERNS.md` — Templates for domain entity tests
- `test/docs/USECASE_TEST_PATTERNS.md` — Templates for use case tests with mocks
- `test/docs/E2E_TEST_PATTERNS.md` — Templates for e2e tests with Docker
- `test/docs/MOCK_CATALOG.md` — All available mocks, builders, and matchers

### Non-negotiable rules

| Rule | Detail |
|------|--------|
| **Run tests before every commit** | Before committing ANY change, run `pnpm test` (unit) and `pnpm test:e2e` (integration/e2e). **Both must pass at 100% with zero failures.** A commit with failing tests — unit or integration — is never acceptable. If a test breaks, fix it before committing. No exceptions, no "I'll fix it later". |
| **Coverage 100%** | `pnpm test:coverage` enforces 100% statements, branches, functions, and lines. If you add code, you add tests. If coverage drops, the CI fails. |
| **TDD mindset** | Write the test first, see it fail (red), implement the code, see it pass (green), refactor. Every new feature, bugfix, or refactor starts with a test. |
| **BDD structure** | All tests use `describe("Given X") / describe("When Y") / it("Then Z")`. No exceptions. See `test/docs/BDD_STYLE_GUIDE.md`. |
| **Exhaustive cases** | Happy path is the minimum. Every test MUST also cover: all error paths (every `throw`), edge cases (0, 1, MAX, negative, null, boundary), and security cases (invalid input, cross-tenant, injection). |
| **1 test file per source file** | Every `.ts` file with logic has a corresponding `.test.ts`. Domain entities, use cases, handlers, repos, middleware — all have tests. |

### Unit tests (`tests/unit/`)

- **Domain tests**: Zero mocks. Test pure logic via `create()`/`reconstruct()`. Cover every state × action combination.
- **Use case tests**: Mock all ports with `mock<Interface>()` from `vitest-mock-extended`. Verify orchestration: which repos are called, with what arguments, in what order.
- **Infrastructure tests**: Mock Prisma/Hono. Test adapters, middleware, handlers in isolation.

### E2E tests (`tests/e2e/`) — MUST be robust

E2E tests run in Docker (PostgreSQL + App containers, isolated from dev). They MUST cover the **12 security categories** for every endpoint:

1. **Authentication** — missing/invalid/malformed API keys, SQL injection in credentials
2. **Input validation** — negative, zero, float, string, overflow, XSS, prototype pollution, malformed JSON
3. **Cross-tenant isolation** — attacker platform MUST NOT access victim's resources (wallets, holds, transactions)
4. **Balance manipulation** — overdraft, self-transfer, operations on frozen/closed wallets
5. **Idempotency** — replay returns cached response, payload mismatch detected, cross-endpoint key reuse
6. **Concurrency & race conditions** — concurrent deposits (balance consistency), concurrent withdrawals (no negative balance), bidirectional transfers (no deadlocks), concurrent holds (no over-reservation)
7. **Hold exploitation** — double capture, capture after void, oversized hold, expired hold
8. **Wallet lifecycle** — state machine transitions, invalid transitions rejected
9. **Ledger integrity** — zero-sum movements, cached balance = ledger sum, immutable triggers block UPDATE/DELETE
10. **Edge cases** — minimum values (1 cent), cross-currency rejection, non-existent resources, invalid UUIDs
11. **Information disclosure** — no stack traces in errors, no framework headers, consistent 404 (no enumeration)

When adding a new endpoint, create e2e tests covering ALL applicable categories above.

### Test commands

```bash
pnpm test              # Unit tests (~1s)
pnpm test:watch        # Unit tests in watch mode
pnpm test:e2e          # E2E tests — auto-starts Docker containers (~30s)
pnpm test:coverage     # Unit + E2E combined, enforces 100% coverage
pnpm test:all          # Unit then E2E sequentially
```

### Test infrastructure

- **Docker isolation**: `docker-compose.test.yml` uses project `wallet-test`, PostgreSQL on `:5433` (DB `wallet_test`), App on `:3333`. Dev containers (`:5432`/`:3000`) are never touched.
- **Seed data**: Only 2 test platforms (test + attacker) are seeded. Each test creates its own business data via API and `reset()` truncates between tests.
- **Mocking**: `vitest-mock-extended` for type-safe interface mocks. Builders (`WalletBuilder`, `HoldBuilder`) use `reconstruct()` to create entities in any state.

---

## Memory Bank

Refer to these docs:

- `docs/domain.md` — Domain model and business rules
- `docs/datamodel.md` — Data model
- `docs/projectbrief.md` — Project summary
- `docs/architecture/backend-architecture.md` — DDD + Hexagonal + CQRS layout
- `docs/architecture/systemPatterns.md` — Architecture patterns
- `docs/architecture/techContext.md` — Stack and setup
- `docs/architecture/database-migrations.md` — Prisma migrations
- `docs/activeContext.md` — Current focus
- `docs/progress.md` — Status and progress
- `test/docs/TESTING_GUIDE.md` — **Master testing guide (read before writing any test)**
- `test/docs/E2E_TEST_PATTERNS.md` — E2E patterns with 12 security categories
- `test/docs/BDD_STYLE_GUIDE.md` — Given/When/Then naming rules
- `test/docs/DOMAIN_TEST_PATTERNS.md` — Domain entity test templates
- `test/docs/USECASE_TEST_PATTERNS.md` — Use case test templates with mocks
- `test/docs/MOCK_CATALOG.md` — All available mocks, builders, matchers
