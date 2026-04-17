# Wallet Service — Agent Instructions

Instructions for AI coding agents (Cursor, Codex, etc.) working on the Wallet Service.

## Canonical Source

- `AGENTS.md` is the canonical project instruction file for shared AI guidance.
- `CLAUDE.md` exists only as a compatibility wrapper for Claude Code and imports this file.
- Do not duplicate these instructions in `.cursor/rules/` unless a Cursor-only capability truly requires it.
- When updating agent guidance, update `AGENTS.md` first and keep wrappers minimal.

## Load Relevant Context First

Before any task, read the relevant files below. Do not implement before loading the applicable context.

| Task area | Read first |
|-----------|------------|
| Domain, business rules, or data | `docs/domain.md`, `docs/datamodel.md` |
| Backend, API, or architecture | `docs/projectbrief.md`, `docs/architecture/techContext.md`, `docs/architecture/systemPatterns.md`, `docs/architecture/backend-architecture.md` |
| Database or migrations | `docs/architecture/database-migrations.md` |
| Testing | `test/docs/TESTING_GUIDE.md`, `test/docs/BDD_STYLE_GUIDE.md`, `test/docs/DOMAIN_TEST_PATTERNS.md`, `test/docs/USECASE_TEST_PATTERNS.md`, `test/docs/E2E_TEST_PATTERNS.md`, `test/docs/MOCK_CATALOG.md` |
| Current focus / recent status | `docs/activeContext.md`, `docs/progress.md` |

## Service Snapshot

**Wallet Service** is a standalone digital wallet microservice. Platforms integrate via REST API using API keys. The service provides wallet management, deposits, withdrawals, P2P transfers, holds/authorizations, and a double-entry immutable transaction ledger.

- **Stack:** Hono, TypeScript 5+ (strict), Node.js 22+, PostgreSQL 16, Prisma 7, Zod, hono-openapi, Scalar, uuidv7, Pino, Vitest, Biome, pnpm
- **Local development:** Docker Compose for PostgreSQL
- **Production:** Plain Node.js process + managed PostgreSQL; no Docker

## Key Paths

| Path | Purpose |
|------|---------|
| `src/` | Application source code |
| `src/common/` | Cross-cutting features with full architecture; not a bounded context. Currently includes idempotency |
| `src/utils/` | Pure reusable toolkit; zero use cases |
| `src/utils/kernel/` | Domain-safe abstractions; no infra dependencies |
| `src/utils/application/` | Application-level interfaces such as CQRS, `IIDGenerator`, `ITransactionManager` |
| `src/utils/infrastructure/` | Infrastructure implementations such as buses, Hono helpers, Prisma transaction manager, UUID generator, scheduler, observability |
| `src/utils/middleware/` | HTTP middlewares: `apiKeyAuth`, `idempotency`, `requestResponseLog`, `trackingCanonical` |
| `src/wallet/` | Wallet bounded context |
| `src/wallet/domain/ports/` | Write repository interfaces |
| `src/wallet/application/ports/` | Read-store interfaces |
| `src/wallet/application/command/` | Commands; each use case uses `command.ts` + `usecase.ts` |
| `src/wallet/application/query/` | Queries; each use case uses `query.ts` + `usecase.ts` |
| `src/wallet/infrastructure/adapters/inbound/http/` | Route files plus per-endpoint `schemas.ts` + `handler.ts` folders |
| `src/wallet/infrastructure/adapters/inbound/scheduler/` | Wallet cron jobs |
| `src/wallet/infrastructure/adapters/outbound/prisma/` | Prisma repositories and read stores |
| `prisma/` | Prisma schema and migrations |
| `prisma/immutable_ledger.sql` | PostgreSQL trigger + constraints for append-only ledger |
| `docs/` | Domain, data model, and architecture documentation |

## Core Rules

- **Language:** Code and comments in English. Documentation in English. Responses to the user always in Spanish.
- **Credentials:** Never hardcode credentials; use environment variables.
- **Timestamps:** Use Unix milliseconds as `number` everywhere. In the DB they are `BigInt`. Keep a single representation end-to-end; no conversions.
- **Amounts:** Use integer minor units as `BigInt`. `$1.99 = 199`. Never use float or decimal. The API sends and receives `amount_minor: number`. Supported currencies: USD, EUR, MXN, CLP, KWD.
- **Entity IDs:** Use UUID v7 only, generated in application code through `IIDGenerator`. The DB never generates IDs. Never use UUID v4.
- **Currency:** `currency_code` must be valid ISO 4217 uppercase. Cross-currency transfers are not allowed.
- **System wallets:** One per `(platform, currency)`, with `owner_id = "SYSTEM"` and `is_system = true`. Auto-create on first wallet creation for that platform/currency. System wallets cannot be frozen or closed.
- **Ledger:** Double-entry bookkeeping. Every financial operation produces exactly two `LedgerEntry` records, one debit and one credit. `ledger_entries` is immutable and append-only: never `UPDATE`, never `DELETE`. PostgreSQL trigger protects it.

## Architecture and Layering

- **Domain and application layers:** No third-party libraries. Do not import Prisma, Pino, uuidv7, Zod, Hono, or anything from `utils/infrastructure/` or `utils/middleware/`. Allowed imports: TypeScript standard library, interfaces/ports, and `utils/kernel/`. Third-party libraries live only in adapters.
- **CQRS:** Commands and queries are separate and dispatched through `ICommandBus` / `IQueryBus`. Commands may return minimal data such as a created ID; never full aggregates or rich DTOs. No Event Sourcing. No Event-Driven integration between BCs; communication is synchronous.
- **CQRS file structure:** Each command use case has two files: `command.ts` for pure command/result types and `usecase.ts` for the use case class. Each query uses `query.ts` for query/DTO types and `usecase.ts` for the use case class.
- **Queries:** Use ReadStore ports and return DTOs directly. Do not load aggregates for reads. ReadStore interfaces live in `wallet/application/ports/`.
- **Outbound ports:** All outbound port methods, including repositories, read stores, and transaction manager, receive `ctx: AppContext` as the first parameter. Adapters often receive `ILogger` in the constructor for traceability; an adapter may instead receive another dependency such as `IIDGenerator` if that fits the adapter.
- **AppContext:** In HTTP handlers use `buildAppContext(c)` from `utils/infrastructure/hono.context.ts`. In non-HTTP flows such as jobs, scripts, and tests use `createAppContext(idGen)` from `utils/kernel/context.ts`. Never build `AppContext` manually with `c.get()`.
- **Scheduled jobs:** Cron jobs are inbound adapters, same category as HTTP routes. The scheduler dispatches commands through the `CommandBus`. Each BC or common feature defines its jobs in `infrastructure/adapters/inbound/scheduler/`.
- **Naming: interfaces:** All interfaces use the `I` prefix, for example `IWalletRepository`, `ILogger`, `IIDGenerator`, `ITransactionManager`, `IWalletReadStore`. Class implementations do not use the prefix. Use case classes are named `XUseCase`, not `XHandler`.
- **Naming: files:** Use dotted suffix naming such as `wallet.aggregate.ts`, `hold.entity.ts`, `wallet.errors.ts`, `wallet.repository.ts`, `wallet.repo.ts`, `wallet.readstore.ts`, `transaction.manager.ts`, `idempotency.store.ts`, `logger.port.ts`, `sensitive.filter.ts`, `id.generator.ts`, `command.ts`, `query.ts`, `usecase.ts`.
- **Struct ordering:** Put the constructor or static `create`/factory immediately after the class definition, before methods. Order: class, constructor/factory, methods.

## HTTP and API

- **API style:** REST. Every mutation requires the `Idempotency-Key` header.
- **API documentation:** Generate docs automatically with hono-openapi + Scalar. `/openapi` serves the OpenAPI 3.1 JSON spec. `/docs` serves the interactive Scalar UI. Never write API docs manually.
- **Endpoint checklist:** When adding or modifying an endpoint: define request schemas (`ParamSchema`, `BodySchema`, `QueryParamsSchema`) and `ResponseSchema` in `schemas.ts`; add `describeRoute({ tags, summary, responses })` in the handler with `resolver(ResponseSchema)` and `resolver(ErrorResponseSchema)`; use `validator` from `hono-openapi` aliased as `zValidator`, never `@hono/zod-validator`; register the route in the appropriate routes file. `/openapi` and `/docs` update automatically.
- **Global middleware chain:** In `index.ts` the order is `trackingCanonical` -> `cors` from `hono/cors` -> `secureHeaders` from `hono/secure-headers` -> `requestResponseLog`. Then, per route group: `apiKeyAuth` -> `idempotency` for mutations only.
- **Route mounting:** `index.ts` creates the versioned router with `app.basePath("/v1")`, then mounts groups such as `v1.route("/wallets", walletRoutes(deps))`. Route files must not repeat the `/v1` prefix. `/health`, `/openapi`, and `/docs` live outside `/v1`.
- **HTTP handlers:** Use `handlerFactory.createHandlers()` from `utils/infrastructure/hono.context.ts`. Each endpoint folder contains `schemas.ts` and `handler.ts`. Do not add `try/catch`; errors propagate to the global `onError`. Route files receive `commandBus` and `queryBus` and only perform routing.
- **BigInt serialization:** Convert Prisma `BigInt` values with `utils/kernel/bigint.ts`, especially `toSafeNumber`, `toNumber`, and `bigIntReplacer`. Never expose raw `bigint` in API responses.

## Concurrency and Transactions

- **Concurrency model:** All wallet mutations use optimistic locking via the `version` field. `TransactionManager` retries internally three times with exponential backoff under Serializable isolation. If retries are exhausted, return `409 VERSION_CONFLICT`; the client retries with the same idempotency key. Do not use `SELECT FOR UPDATE` in domain ports. All mutations use idempotency keys with the atomic acquire pattern. Database `CHECK` constraints remain the safety net.
- **TransactionManager usage:** Use `txManager.run()` only when a use case performs multiple writes that must be atomic, such as wallet + transaction + ledger entries. Single idempotent writes, such as `ExpireHoldsUseCase`, and read-only queries do not need a transaction wrapper.

## Observability and Error Handling

- **Logging:** Use `ILogger`, wired as `PinoAdapter -> SensitiveKeysFilter -> SafeLogger`. Use `mainLogTag` per file and `methodLogTag` per method; every message starts with `methodLogTag`. Production goal: every request must be reconstructable from logs alone. Log `debug` for handler entry, params, intermediate values, adapter calls, and transaction begin/commit/rollback. Log `info` for successful business operations and noteworthy domain events. Log `warn` for client errors such as validation failures, malformed JSON, and optimistic locking conflicts. Log `error` for server-side and infrastructure failures. Log `fatal` when the process must shut down. Always log handler entry, success, and early returns. Adapter methods log every DB call at `debug`. Client errors are `warn`, not `error`.
- **Error handling:** Use `AppError` with Kind, Code, and Message. Domain errors are factory functions returning `AppError`. Application sentinel errors are also `AppError`. Handlers throw; the global `onError` in `index.ts` catches `AppError`, maps Kind to HTTP status with `httpStatus()`, and returns `errorResponse(c, code, msg, status)` in the form `{"error":"CODE","message":"..."}`. Middleware uses `errorResponse()` directly. Both rely on `utils/infrastructure/hono.error.ts`. Every error needs a unique `UPPER_SNAKE_CASE` code.

## Workflow

1. For domain changes, update `docs/domain.md` and `docs/datamodel.md` before or with the code change.
2. After significant work, update `docs/activeContext.md` and `docs/progress.md`.
3. Follow `docs/architecture/backend-architecture.md` and `docs/architecture/systemPatterns.md`; domain and application depend only on interfaces.
4. **CRITICAL — Schema changes require a migration.** Every modification to `prisma/schema.prisma` (new column, renamed field, new model, index change, etc.) MUST be accompanied by a Prisma migration in the same commit. The flow is:
   1. Edit `prisma/schema.prisma`
   2. Run `npx prisma migrate dev --name <descriptive_name> --config prisma/prisma.config.ts` against the local Docker DB
   3. Verify the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`
   4. Commit both the schema change AND the migration file together
   **NEVER use `db push` as a substitute for `migrate dev`.** `db push` syncs the local DB without creating a migration file — production only applies migrations via `prisma migrate deploy`, so schema changes made with `db push` alone will never reach production. This has caused production outages. If the local DB has drift (was previously synced with `db push`), run `prisma migrate reset` first to realign it with the migration history, then generate the new migration. Production flow: `prisma migrate deploy` and then `psql $DATABASE_URL -f prisma/immutable_ledger.sql`.
5. For a new endpoint: create `schemas.ts`, create `handler.ts` with `describeRoute()` and validators, then register the route in the appropriate routes file.
6. Before every commit, run `pnpm test` and `pnpm test:e2e`. Both suites must pass at 100% with zero failures. Never commit with broken tests.
7. Husky hooks are mandatory. Never bypass them with `--no-verify`.
8. `pre-commit` runs `lint-staged` on staged files, then runs the full unit test suite with 100% coverage enforcement:
   - `src/**/*.ts`: `biome check` and `check-layer-violations.cjs`
   - `src/**/domain/**/*.ts`: `check-financial-patterns.cjs` to block `parseFloat`, `Number()`, and float arithmetic on money
   - `src/**/application/**/*.ts`: `check-financial-patterns.cjs` to block `parseFloat`, `Number()`, and float arithmetic on money
   - After lint-staged: `pnpm test:coverage` runs all unit tests and fails if coverage drops below 100%
9. `pre-push` validates the full project before any `git push` with `pnpm lint`, `pnpm tsc --noEmit`, and `pnpm test:coverage`.

## Testing (Mandatory)

Every code change must include tests. No exceptions. Think TDD: write or update the test first, confirm the red state, implement the minimum code to pass, then refactor with the suite green. New features must follow strict TDD end-to-end; implementation does not start before the failing test exists. Bugfixes and refactors also start with a test whenever behavior is added, changed, or protected.

### Non-Negotiable Test Rules

- Before committing any change, run `pnpm test` and `pnpm test:e2e`. Both must pass at 100% with zero failures. A commit with failing unit or e2e tests is never acceptable.
- `pnpm test:coverage` enforces 100% statements, branches, functions, and lines.
- All tests use `describe("Given X") / describe("When Y") / it("Then Z")`.
- Happy path is the minimum. Also cover every `throw`, edge cases such as `0`, `1`, max values, negative values, `null`, and boundaries, plus security cases such as invalid input, cross-tenant access, and injection.
- Every HTTP endpoint in the service must have e2e coverage. If a change affects an endpoint, create or update its e2e tests in the same task.
- Every `.ts` file with logic has a corresponding `.test.ts`. Domain entities, use cases, handlers, repositories, and middleware all need tests.

### Unit Tests

- **Domain tests:** Zero mocks. Test pure logic through `create()` and `reconstruct()`. Cover every state-by-action combination.
- **Use case tests:** Mock all ports with `mock<Interface>()` from `vitest-mock-extended`. Verify orchestration, arguments, and call order.
- **Infrastructure tests:** Mock Prisma and Hono. Test adapters, middleware, and handlers in isolation.

### E2E Requirements

E2E tests run in Docker with isolated PostgreSQL and app containers. Every HTTP endpoint must have e2e coverage and, where applicable, cover these 11 security categories:

1. Authentication: missing, invalid, malformed API keys, SQL injection in credentials
2. Input validation: negative, zero, float, string, overflow, XSS, prototype pollution, malformed JSON
3. Cross-tenant isolation: attacker platform must not access victim wallets, holds, or transactions
4. Balance manipulation: overdraft, self-transfer, operations on frozen or closed wallets
5. Idempotency: replay returns cached response, payload mismatch, cross-endpoint key reuse
6. Concurrency and race conditions: concurrent deposits with balance consistency, concurrent withdrawals with no negative balance, bidirectional transfers with no deadlocks, concurrent holds with no over-reservation
7. Hold exploitation: double capture, capture after void, oversized hold, expired hold
8. Wallet lifecycle: state machine transitions and invalid transitions
9. Ledger integrity: zero-sum movements, cached balance equals ledger sum, immutable trigger blocks `UPDATE` and `DELETE`
10. Edge cases: minimum value of one cent, cross-currency rejection, non-existent resources, invalid UUIDs
11. Information disclosure: no stack traces, no framework headers, consistent `404` with no enumeration

When adding a new endpoint, create e2e tests for all applicable categories. When modifying an existing endpoint, update its e2e tests in the same change.

### Test Commands

```bash
pnpm test
pnpm test:watch
pnpm test:e2e
pnpm test:coverage
pnpm test:all
```

### Test Infrastructure

- `docker-compose.test.yml` uses project `wallet-test`, PostgreSQL on `:5433` with DB `wallet_test`, and the app on `:3333`. Development containers on `:5432` and `:3000` are never touched.
- Only two test platforms, test and attacker, are seeded. Each test creates its own business data through the API, and `reset()` truncates data between tests.
- Use `vitest-mock-extended` for type-safe interface mocks. Builders such as `WalletBuilder` and `HoldBuilder` use `reconstruct()` to create entities in any state.
