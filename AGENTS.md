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
| **Naming: interfaces** | All interfaces start with `I` prefix: `IWalletRepository`, `ILogger`, `IIDGenerator`, `ITransactionManager`, `IWalletReadStore`, etc. Class implementations do NOT have the prefix: `PrismaWalletRepo`, `SafeLogger`, `UUIDV7Generator`. |
| **Naming: files** | Dotted suffix convention: `wallet.aggregate.ts`, `hold.entity.ts`, `wallet.errors.ts`, `wallet.repository.ts` (port), `wallet.repo.ts` (adapter), `wallet.readstore.ts`, `transaction.manager.ts`, `idempotency.store.ts`, `logger.port.ts`, `sensitive.filter.ts`, `id.generator.ts`. Command/query types: `command.ts` / `query.ts`. Use case classes: `usecase.ts`. |
| **Struct ordering** | Constructor (static `create`/factory) goes immediately after the class definition, before methods. Order: class → constructor/factory → methods. |
| **API documentation** | **Auto-generated via hono-openapi + Scalar.** `/openapi` serves the OpenAPI 3.1 JSON spec; `/docs` serves the interactive Scalar UI. Documentation is derived from Zod schemas and `describeRoute()` metadata — never write API docs manually. |
| **API endpoint checklist** | When adding or modifying an endpoint: **(1)** Define request schemas (`ParamSchema`, `BodySchema`, `QueryParamsSchema`) and `ResponseSchema` in `schemas.ts`. **(2)** Add `describeRoute({ tags, summary, responses })` with `resolver(ResponseSchema)` and `resolver(ErrorResponseSchema)` in the handler. **(3)** Use `validator` from `hono-openapi` (aliased as `zValidator`), not `@hono/zod-validator`. **(4)** Register the route in the routes file (e.g., `wallets.routes.ts`). The OpenAPI spec updates automatically. |
| **Concurrency** | All wallet mutations: optimistic locking (`version` field). TransactionManager retries internally (3 attempts, exponential backoff) under **Serializable isolation**; if exhausted → `409 VERSION_CONFLICT`, client retries with same idempotency key. No `SELECT FOR UPDATE` in domain ports (infrastructure leak — see `systemPatterns.md`). All mutations: idempotency keys with atomic acquire pattern. Safety net: DB `CHECK` constraints. |
| **Ledger** | Double-entry bookkeeping. Every financial op produces exactly 2 LedgerEntry records (debit + credit). `ledger_entries` is **immutable** (append-only): never UPDATE, never DELETE. Protected by PostgreSQL trigger. |
| **BigInt serialization** | Prisma BigInt → use `utils/kernel/bigint.ts` (`toSafeNumber`, `toNumber`, `bigIntReplacer`). Never expose raw `bigint` in API responses. |
| **AppContext** | Use `buildAppContext(c)` from `utils/infrastructure/hono.context.ts` in HTTP handlers. For non-HTTP flows (jobs, scripts, tests), use `createAppContext(idGen)` from `utils/kernel/context.ts`. Never build `AppContext` manually with `c.get()`. |
| **HTTP handlers** | Use `handlerFactory.createHandlers()` from `utils/infrastructure/hono.context.ts`. Each endpoint folder has `schemas.ts` (Zod request + response schemas) and `handler.ts` (imports schemas, adds `describeRoute()` + validators + handler). No try/catch — errors propagate to the global `onError`. Route files receive `commandBus`/`queryBus` and only do routing. |
| **Outbound ports convention** | All outbound port methods (repositories, read stores, transaction manager) receive `ctx: AppContext` as their **first parameter**. Adapters receive `ILogger` in their constructor. This enables adapters to log with full traceability (`tracking_id`, `platform_id`) without leaking infrastructure into the domain. |
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
