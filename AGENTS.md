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
| **Entity IDs** | **UUID v7 only, generated in code.** App generates all IDs via `IDGenerator`; DB never generates them. Never UUID v4. |
| **API** | REST. All mutations require `Idempotency-Key` header. |
| **Domain and app** | **No external third-party libraries.** No Prisma, Pino, uuidv7, Zod in domain or app. Allowed: TypeScript stdlib, interfaces (ports), and project-internal shared packages (`shared/appError`, `shared/kernel`, `shared/observability`). Third-party libs live only in **adapters**. |
| **CQRS** | Commands (write) and Queries (read) are separate. Commands may return minimal data (created ID) — never full aggregates or rich DTOs. **No Event Sourcing** (ledger_entries is the audit trail). **No Event-Driven** (BCs communicate synchronously). See `backend-architecture.md` § CQRS. |
| **Queries** | Use ReadStore ports (return DTOs directly). Do not load aggregates for reads. |
| **Logging** | Use `Logger` (port); wired as PinoAdapter → SensitiveKeysFilter → SafeLogger. mainLogTag per file, methodLogTag per method; every message starts with methodLogTag. See `docs/architecture/backend-architecture.md` § Logging. |
| **Error handling** | Use `AppError` (Kind + Code + Message). Domain: factory functions returning `AppError`. App: sentinel errors as `AppError`. HTTP handlers: `withError(c, logger, ctx, tag, err)` — maps Kind → HTTP status, returns `{"error": "CODE", "message": "..."}`. Every error needs a unique UPPER_SNAKE_CASE Code. |
| **Struct ordering** | Constructor (static `create`/factory) goes immediately after the class definition, before methods. Order: class → constructor/factory → methods. |
| **API endpoints** | **Never add endpoints without documenting them.** Each directory under `src/api/` must have an **API.md** with method, path, request/response structure, errors, and curl examples. |
| **Concurrency** | Single-wallet ops: optimistic locking (`version` field); mismatch → `409 VERSION_CONFLICT`, client retries. Multi-wallet ops (transfers): `SELECT FOR UPDATE` with deterministic lock order (`ORDER BY id`). All mutations: idempotency keys with atomic acquire pattern. Safety net: DB `CHECK` constraints. |
| **Ledger** | Double-entry bookkeeping. Every financial op produces exactly 2 LedgerEntry records (debit + credit). `ledger_entries` is **immutable** (append-only): never UPDATE, never DELETE. Protected by PostgreSQL trigger. |
| **BigInt serialization** | Prisma BigInt → use `shared/kernel/bigint.ts` (`toSafeNumber`, `toNumber`, `bigIntReplacer`). Never expose raw `bigint` in API responses. |
| **RequestContext** | Use `buildRequestContext(c)` from `shared/kernel/context.ts` in HTTP handlers. Never build `RequestContext` manually with `c.get()`. |
| **Currency** | `currency_code` must be valid ISO 4217 uppercase. Cross-currency transfers not allowed. |
| **System wallets** | One per (platform, currency), `owner_id = "SYSTEM"`, `is_system = true`. Auto-created on first wallet creation for that platform/currency. Cannot be frozen or closed. |

---

## Stack

- **Framework:** Hono — REST API
- **Language:** TypeScript 5+ (strict mode)
- **Runtime:** Node.js (Vercel) / Workerd (Cloudflare Workers)
- **ORM:** Prisma (PostgreSQL)
- **Database:** PostgreSQL 16
- **Validation:** Zod (request schemas)
- **UUID:** uuidv7 (RFC 9562)
- **Logging:** Pino (structured JSON)
- **Testing:** Vitest
- **Linting:** Biome
- **Package manager:** pnpm
- **Orchestration:** Docker Compose (PostgreSQL for dev)

---

## Directory Structure

| Path | Description |
|------|-------------|
| `src/` | Application source code |
| `src/api/` | API composition; **API.md** per group documenting endpoints |
| `src/api/middleware/` | HTTP middlewares. **Global** (all routes): trackingCanonical, requestResponseLog. **Route-group** (authenticated/mutation routes): apiKeyAuth, idempotency. |
| `src/api/respond/` | HTTP error response helper (`withError`); maps AppError Kind → HTTP status |
| `src/wallet/` | Bounded context: Wallet (wallets, transactions, ledger, holds) |
| `src/platform/` | Bounded context: Platform (API key management) |
| `src/shared/appError.ts` | Application error type (Kind + Code + Message); no external deps |
| `src/shared/kernel/` | Cross-cutting: IDGenerator port, RequestContext, HonoVariables, `buildRequestContext` helper, `bigint.ts` serialization utils, adapters (UUID v7) |
| `src/shared/observability/` | Logger port, SafeLogger, SensitiveKeysFilter, CanonicalAccumulator; adapters (Pino) |
| `prisma/` | Prisma schema and migrations |
| `prisma/immutable_ledger.sql` | PostgreSQL trigger + constraints for append-only ledger |
| `docs/` | Domain, data model, architecture documentation |

---

## Workflow Tips

1. **Domain changes**: Update `docs/domain.md` and `docs/datamodel.md` before or with code.
2. **Progress**: Update `docs/activeContext.md` and `docs/progress.md` after significant work.
3. **Architecture**: Follow `docs/architecture/backend-architecture.md` and `docs/architecture/systemPatterns.md`. Domain and app depend only on interfaces.
4. **Migrations**: Use Prisma Migrate; see `docs/architecture/database-migrations.md`. Apply `prisma/immutable_ledger.sql` after migrations for trigger + constraints.
5. **New endpoint**: Create handler, register in setup.ts, document in API.md.

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
