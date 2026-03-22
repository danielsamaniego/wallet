# Backend Architecture — DDD + Hexagonal + CQRS

The backend follows **DDD (Domain-Driven Design) + Hexagonal (Ports & Adapters) + CQRS**, **without Event Sourcing or Event-Driven** patterns. Coordination between bounded contexts is synchronous.

---

## Principles

### Hexagonal (Ports & Adapters)

- **Domain** defines **ports** (interfaces); **adapters** implement them.
- Dependencies point **inward** (domain has no infra dependencies).
- HTTP and scheduled jobs = **driving/inbound adapters** (entry points).
- PostgreSQL (Prisma), external APIs = **outgoing/outbound adapters** (implement domain ports).

### DDD

- `domain/` contains aggregates, entities, value objects, invariants.
- **No** framework, DB, or HTTP dependencies in domain.
- Domain services when logic does not fit a single aggregate.

### Dependency Rule: Domain and App — No External Libraries

**Domain** and **app** (commands, queries, use cases) must **not** use any external third-party library.

- **No** Prisma, Pino, uuidv7, Zod, or other third-party libs in domain or app.
- **Domain** and **app** may depend **only on**:
  - TypeScript/JavaScript standard library
  - Interfaces (ports) defined in the same module
  - Project-internal shared kernel packages (`utils/kernel/`). Never import from `utils/infrastructure/` or `utils/middleware/` in domain or app.
- Concretions (Prisma, Pino, uuidv7, Zod) live in **adapters**.
- Use cases receive repositories, services, and **IIDGenerator** as **interfaces**; wiring injects concrete implementations.
- **ID generation — UUID v7 only, from application code**: Domain treats IDs as plain strings. `IIDGenerator` (port) is implemented exclusively by **UUID v7** (RFC 9562, time-ordered). The app generates all IDs; the database must never generate them. **Never** use UUID v4 or DB-generated IDs for entity IDs.

### CQRS

- **Commands** (write): use domain repositories; mutate aggregates; respect invariants.
- **Queries** (read): return **DTOs**; do **not** load aggregates. Use a ReadStore port that returns DTOs directly; the adapter uses Prisma and maps to DTO.
- Same DB allowed; separate write repo and read store interfaces.
- Command/Query handlers = **use cases** (Application layer).
- **CQRS bus**: Commands and queries are dispatched via `ICommandBus` / `IQueryBus` (defined in `utils/application/cqrs.ts`, implemented in `utils/infrastructure/cqrs.ts`). HTTP handlers and scheduled jobs receive the bus, not individual handler instances. Handlers are registered on the bus in `wiring.ts`.

#### Why commands return data

Strict CQRS says commands should return nothing — the client issues the command, then queries separately for the result. In practice this creates unnecessary round-trips and awkward UX for simple cases like "create a wallet and give me its ID".

**Our rule**: commands may return **simple, minimal data** (e.g. the created ID, a success flag) so the client can fetch full details with a follow-up GET. Commands must **never** return full aggregates or rich DTOs — that is the query side's job.

Examples of acceptable command returns:
- `createWallet` → `{ walletId: string }`
- `deposit` → `{ transactionId: string }`
- `transfer` → `{ sourceTransactionId: string, targetTransactionId: string }`

Examples of what commands must **not** return:
- Full wallet object with balance, status, transactions
- Paginated transaction list
- Anything that requires JOINs or complex queries

### No Event Sourcing — and why

This architecture uses **CQRS without Event Sourcing** and **without Event-Driven patterns**. This is a deliberate choice.

**What Event Sourcing is**: Instead of storing current state, every state change is stored as an immutable event. The current state is reconstructed by replaying events.

**Why we don't use it**:

1. **The double-entry ledger already provides the audit trail.** Event Sourcing's main benefit is full history and auditability — but our `ledger_entries` table is already an append-only, immutable log of every financial operation. We get the audit trail without the complexity of event replay.
2. **State reconstruction complexity.** Rebuilding a wallet's balance from thousands of events on every read adds latency and implementation cost. We use a `cached_balance_cents` field (updated atomically on write) for O(1) reads.
3. **Operational overhead.** Event stores need compaction, snapshotting, and projection rebuilds. For a wallet service where the core invariant is "balance must be consistent", direct state persistence with optimistic locking is simpler and equally correct.
4. **No need for temporal queries.** We don't need "what was the balance at 3pm yesterday?" — the ledger entries with `balance_after_cents` snapshots already answer that question.

**What we use instead**:
- **Direct state persistence**: Aggregates are loaded, mutated, and saved. The DB holds current state.
- **Immutable ledger**: `ledger_entries` gives us the audit trail that Event Sourcing would provide.
- **CQRS separation**: Write side (commands + repositories) and read side (queries + read stores) are separate interfaces, even though they share the same database.

**No Event-Driven either**: Bounded contexts communicate synchronously (direct function calls via wiring). No message bus, no eventual consistency between BCs. The Wallet BC and Platform BC are in the same process and share the same transaction when needed.

---

## Amounts and Timestamps

### Amounts

All financial amounts use **integer cents** (BigInt). The smallest currency unit. No floating point.

### Timestamps

**Unix ms** (number) everywhere: DB (BigInt), domain, ports, DTOs, API. Single representation, no conversion.

---

## Directory Structure

```
src/
├── common/                          # Cross-cutting features with full architecture (NOT a bounded context)
│   └── idempotency/                 # Idempotency feature
│       ├── application/
│       │   ├── command/cleanupIdempotency/  # command.ts + usecase.ts
│       │   └── ports/
│       │       └── idempotency.store.ts     # IIdempotencyStore + IdempotencyRecord
│       └── infrastructure/adapters/
│           ├── inbound/scheduler/           # cleanupIdempotency.job.ts + jobs.ts
│           └── outbound/prisma/             # idempotency.store.ts (PrismaIdempotencyStore)
├── utils/                           # Pure toolkit, zero use cases
│   ├── kernel/                      # Domain-safe abstractions (NO infra deps). Equivalent to domain+application pragmatically
│   │   ├── appError.ts
│   │   ├── bigint.ts
│   │   ├── context.ts              # AppContext, createAppContext
│   │   ├── listing.ts
│   │   └── observability/
│   │       ├── canonical.ts
│   │       └── logger.port.ts      # ILogger port
│   ├── application/                 # Application-level interfaces
│   │   ├── cqrs.ts                 # ICommand, IQuery, ICommandHandler, IQueryHandler, BusMiddleware, ICommandBus, IQueryBus
│   │   ├── id.generator.ts         # IIDGenerator
│   │   └── transaction.manager.ts  # ITransactionManager
│   ├── infrastructure/              # Infra implementations
│   │   ├── cqrs.ts                 # CommandBus, QueryBus implementations
│   │   ├── hono.context.ts         # HonoVariables, buildAppContext, handlerFactory
│   │   ├── hono.error.ts           # errorResponse, validationHook, ErrorResponseSchema
│   │   ├── listing.prisma.ts       # buildPrismaListing
│   │   ├── listing.zod.ts          # createListingQuerySchema
│   │   ├── prisma.transaction.manager.ts
│   │   ├── scheduler.ts            # startScheduledJobs (inbound adapter for timer-based command dispatch)
│   │   ├── uuidV7.ts               # UUIDV7Generator
│   │   └── observability/
│   │       ├── pino.adapter.ts
│   │       ├── safe.logger.ts
│   │       └── sensitive.filter.ts
│   └── middleware/                   # All HTTP middlewares in one place
│       ├── apiKeyAuth.ts
│       ├── idempotency.ts           # middleware (imports IIdempotencyStore from common/)
│       ├── requestResponseLog.ts
│       └── trackingCanonical.ts
├── wallet/                          # Bounded context
│   ├── domain/
│   │   ├── wallet/, hold/, transaction/, ledgerEntry/, movement/  # entities/aggregates
│   │   └── ports/                   # domain repository interfaces (IWalletRepository, IHoldRepository, etc.)
│   ├── application/
│   │   ├── command/                 # 11 commands (createWallet, deposit, withdraw, transfer, placeHold, captureHold, voidHold, freezeWallet, unfreezeWallet, closeWallet, expireHolds)
│   │   ├── query/                   # 3 queries (getWallet, getTransactions, getLedgerEntries)
│   │   └── ports/                   # read store interfaces (IWalletReadStore, ITransactionReadStore, ILedgerEntryReadStore)
│   └── infrastructure/adapters/
│       ├── inbound/
│       │   ├── http/                # route files + per-endpoint handler/schemas folders
│       │   │   ├── wallets.routes.ts
│       │   │   ├── transfers.routes.ts
│       │   │   ├── holds.routes.ts
│       │   │   └── deposit/, withdraw/, transfer/, ...  # per-endpoint folders (schemas.ts + handler.ts)
│       │   └── scheduler/           # expireHolds.job.ts + jobs.ts (wallet-specific scheduled jobs)
│       └── outbound/prisma/         # repository and readstore implementations
├── config.ts
├── index.ts                         # App bootstrap, mounts routes and scheduled jobs
└── wiring.ts                        # DI: instantiates all deps, registers commands/queries on buses
```

---

## Bounded Contexts

| BC | Responsibility |
|----|----------------|
| **Wallet** | Wallets, transactions, ledger entries, holds. Deposits, withdrawals, transfers, hold lifecycle. Double-entry bookkeeping. |
| **Platform** | API key management, platform registration. Authentication of API consumers. *(Not yet implemented — planned.)* |

---

## Cross-Cutting Modules

| Module | Location | Role |
|--------|----------|------|
| **common/** | `src/common/` | Global features with complete architecture (ports, adapters, use cases) that don't belong to specific BCs. Currently contains idempotency feature (cleanup job, store port, Prisma adapter). NOT a bounded context. |
| **utils/** | `src/utils/` | Pure toolkit — reusable utilities that are NOT features. Contains kernel (domain-safe abstractions), application interfaces (CQRS, IIDGenerator, ITransactionManager), infrastructure implementations, and HTTP middlewares. |
| **utils/kernel/** | `src/utils/kernel/` | Domain-safe abstractions. Equivalent to domain+application pragmatically. Kernel must NOT depend on infrastructure or external libraries. Contains AppError, AppContext, BigInt utils, listing types, ILogger port. |

---

## HTTP and Application Layers

| Layer | Location | Role |
|-------|----------|------|
| **HTTP / Inbound** | `wallet/infrastructure/adapters/inbound/http/` | Parse request, validate format, dispatch Command/Query via bus, return response. |
| **Application** | `wallet/application/command/`, `wallet/application/query/` | Orchestrate domain and ports; use case logic. |

---

## Route Registration (routes.ts)

Each route group has its own routes file colocated with the bounded context:

| Module | Base path | Responsibilities |
|--------|-----------|-------------------|
| `wallet/infrastructure/adapters/inbound/http/wallets.routes.ts` | `/v1/wallets` | Create wallet, deposit, withdraw, freeze, unfreeze, close, get balance |
| `wallet/infrastructure/adapters/inbound/http/transfers.routes.ts` | `/v1/transfers` | P2P transfers between wallets |
| `wallet/infrastructure/adapters/inbound/http/holds.routes.ts` | `/v1/holds` | Place, capture, void holds |

`index.ts` creates the app, registers middleware, and mounts each route group. Route files receive `commandBus` / `queryBus` (not individual handler instances).

### API documentation (auto-generated)

API documentation is **auto-generated** from Zod schemas and `describeRoute()` metadata via `hono-openapi` + `@scalar/hono-api-reference`. No manual API docs.

- `/openapi` — OpenAPI 3.1 JSON spec (generated at runtime from route metadata)
- `/docs` — Interactive Scalar UI for exploring and testing the API

Request schemas (`ParamSchema`, `BodySchema`, `QueryParamsSchema`) are autodiscovered from `validator()` calls. Response schemas use `resolver(ResponseSchema)` in `describeRoute()`.

---

## Handler Rules

### Command use case (write)

Each command use case lives in its own directory with **two files**:

- **`command.ts`** — Pure type definitions: the command interface (input) and optional result interface (output). No dependencies, no logic. This keeps the contract readable and importable without pulling in handler dependencies.
- **`usecase.ts`** — The use case class (handler). Imports the command/result types from `./command.js`. Depends only on interfaces (repos, services, ports); no external libraries.

```
application/command/deposit/
├── command.ts    ← DepositCommand, DepositResult (types only)
└── usecase.ts    ← DepositHandler (imports from command.ts)
```

Rules:
- Validation at use-case level.
- Transactional boundary (Prisma transaction via TransactionManager).
- Load aggregates → call aggregate methods → Save.
- **May return**: IDs or minimal data for follow-up GET.
- **Must not**: return full aggregates or rich DTOs.

### Query use case (read)

Each query use case lives in its own directory with **two files**:

- **`query.ts`** — Pure type definitions: the query interface (input), DTO interfaces (output), and pagination types. No dependencies.
- **`usecase.ts`** — The use case class (handler). Imports types from `./query.js`.

```
application/query/getWallet/
├── query.ts      ← GetWalletQuery, WalletDTO (types only)
└── usecase.ts    ← GetWalletHandler (imports from query.ts)
```

ReadStore interfaces are extracted into `wallet/application/ports/` (e.g., `wallet.readstore.ts`, `transaction.readstore.ts`, `ledgerEntry.readstore.ts`).

Rules:
- Depends only on **interfaces** (ReadStore, etc.); no external libraries.
- Validate params → call ReadStore → return DTO.
- **Must not**: load aggregates to build response.

### HTTP handler (inbound adapter)

Each endpoint folder has **two files**:

- **`schemas.ts`** — Zod request schemas (`ParamSchema`, `BodySchema`, `QueryParamsSchema`) and `ResponseSchema`. Single source of truth for validation and OpenAPI documentation.
- **`handler.ts`** — Imports from `schemas.ts`. Uses `describeRoute()` (tags, summary, responses with `resolver()`) + `validator()` from `hono-openapi` + the async handler function, all inside `handlerFactory.createHandlers()`.

```
wallet/infrastructure/adapters/inbound/http/deposit/
├── schemas.ts    ← ParamSchema, BodySchema, ResponseSchema (Zod)
└── handler.ts    ← describeRoute + validators + handler logic
```

**Handler pattern:**

```typescript
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { ErrorResponseSchema, validationHook } from "utils/infrastructure/hono.error.js";
import { BodySchema, ParamSchema, ResponseSchema } from "./schemas.js";

export function depositRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    describeRoute({
      tags: ["Wallets"],
      summary: "Deposit funds into a wallet",
      responses: {
        201: { description: "Deposit completed", content: { "application/json": { schema: resolver(ResponseSchema) } } },
        400: { description: "Validation error", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
        404: { description: "Wallet not found", content: { "application/json": { schema: resolver(ErrorResponseSchema) } } },
      },
    }),
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);
      const result = await commandBus.dispatch(ctx, { ... });
      return c.json({ transaction_id: result.transactionId, movement_id: result.movementId }, 201);
    },
  );
}
```

Rules:
- **All mutations require Idempotency-Key header.**
- No try/catch — errors propagate to the global `onError`.
- Use `validator` from `hono-openapi` (aliased as `zValidator`), **not** `@hono/zod-validator`.
- Every endpoint must have `describeRoute()` with `resolver(ResponseSchema)` and `resolver(ErrorResponseSchema)`.
- Route files receive `commandBus`/`queryBus` and only do routing.

### Listing endpoints (paginated queries)

Paginated GET endpoints use the **reusable listing system** for Stripe-style filtering, dynamic sorting, and keyset cursor pagination.

**In `schemas.ts`**, define a `ListingConfig` and generate the query schema:

```typescript
import { createListingQuerySchema } from "utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "utils/kernel/listing.js";

const listingConfig: ListingConfig = {
  filterableFields: [
    { apiName: "type", prismaName: "type", type: "enum", operators: ["eq", "in"],
      enumValues: ["deposit", "withdrawal", "transfer_in", "transfer_out"] },
    { apiName: "amount_cents", prismaName: "amountCents", type: "bigint",
      operators: ["eq", "gt", "gte", "lt", "lte"] },
    { apiName: "created_at", prismaName: "createdAt", type: "bigint",
      operators: ["gt", "gte", "lt", "lte"] },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount_cents", prismaName: "amountCents" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 50,
};

export const QueryParamsSchema = createListingQuerySchema(listingConfig);
```

**Supported query param formats:**

```
?filter[type]=deposit              # eq
?filter[type]=deposit,withdrawal   # implicit in (CSV)
?filter[amount_cents][gte]=1000    # explicit operator
?sort=-amount_cents,created_at     # multi-field, - prefix = desc
?limit=20&cursor=eyJ...            # keyset cursor pagination
```

**In the handler**, use `zValidator("query", QueryParamsSchema, validationHook)` — the schema auto-validates filters, sort, limit, and cursor (including sort signature mismatch detection).

**In the readstore**, use `buildPrismaListing()` from `utils/infrastructure/listing.prisma.ts` to convert the `ListingQuery` into Prisma `where`/`orderBy`/`take` clauses with keyset WHERE pagination.

---

## Composite Read Models

**Where to put them:** inside each BC in `application/query/`, e.g. `wallet/application/query/getTransactions/`, `wallet/application/query/getLedgerEntries/`.

Each BC owns its composite read models (pagination, joins, aggregations). No dedicated `views/` BC.

**Rules:**
- Queries return DTOs; adapter runs Prisma queries (includes, selects, complex filters).
- Do **not** put these in aggregate repositories.
- Same DB: Prisma includes/relations across models are fine in read store only.

---

## Policies / Specifications

When reusable rules appear ("can withdraw", "can freeze", "is eligible for X"):

1. **First**: put them in the aggregate (e.g. `wallet.canWithdraw(amount)`).
2. **If they don't fit a single aggregate**: use `domain/services/`.
3. **Optional**: add `domain/policies/` when rules are reused across aggregates or BCs.

---

## Error Handling

The backend uses a **structured, layered error strategy** built on `utils/kernel/appError`. Errors flow from domain → app → HTTP adapter, where they are translated to HTTP responses. Domain and app remain transport-agnostic.

### Error type: `AppError`

`utils/kernel/appError.ts` defines a single error class used across all layers. No external dependencies.

```typescript
class AppError extends Error {
  readonly kind: ErrorKind;   // semantic category
  readonly code: string;      // stable UPPER_SNAKE_CASE (e.g. "INSUFFICIENT_FUNDS")
  readonly msg: string;       // human-readable fallback
  readonly cause?: Error;     // wrapped original error (not exposed to API)
}
```

**ErrorKind** classifies the error by business semantics, not by HTTP status:

| Kind | Meaning | HTTP mapping |
|------|---------|-------------|
| `Validation` | Invalid input | 400 |
| `Unauthorized` | Authentication failed | 401 |
| `Forbidden` | Not allowed | 403 |
| `NotFound` | Resource not found | 404 |
| `Conflict` | State conflict (duplicate, version mismatch) | 409 |
| `DomainRule` | Business rule violation | 422 |
| `Internal` | Unexpected internal error | 500 |

### How each layer uses errors

**Domain** — defines domain-specific error factories returning `AppError`:

```typescript
// wallet/domain/wallet/errors.ts
export const ErrInsufficientFunds = (walletId: string) =>
  AppError.domainRule("INSUFFICIENT_FUNDS", `wallet ${walletId} has insufficient available funds`);
```

**Application** — defines use-case sentinels as `AppError`:

```typescript
// wallet/application/command/deposit/usecase.ts
const ErrWalletNotFound = AppError.notFound("WALLET_NOT_FOUND", "wallet does not exist");
```

**HTTP handlers** throw errors naturally — the global `onError` in `index.ts` catches them and uses `errorResponse()` to produce structured JSON. No try/catch in individual handlers.

### API error response format

All error responses follow a consistent structure:

```json
{
  "error": "INSUFFICIENT_FUNDS",
  "message": "wallet xyz has insufficient available funds"
}
```

- `error`: stable UPPER_SNAKE_CASE code. Clients use this for programmatic handling.
- `message`: human-readable fallback. Clients should prefer their own localized messages.

### Rules

1. **Domain and app** import only from `utils/kernel/` (no external deps). Never from `utils/infrastructure/` or `utils/middleware/`. No Hono, no HTTP concepts.
2. **Error translation** is centralized: `errorResponse()` and `httpStatus()` in `utils/infrastructure/hono.error.ts`. Middleware calls `errorResponse()` directly; handlers let errors propagate to the global `onError`.
3. **Use `AppError.is()`** for type checking. Never compare errors with `===`.
4. Every new error must have a **unique, stable Code** (UPPER_SNAKE_CASE). Codes are part of the API contract.
5. **Infrastructure errors** (Prisma, external APIs) not wrapped in `AppError` are caught by the global `onError` and returned as 500 `INTERNAL_ERROR`.

---

## Logging

**The entire backend** uses a single logging abstraction. Domain and app depend only on the **port** `ILogger` (`utils/kernel/observability/logger.port.ts`); concrete implementations (PinoAdapter, SafeLogger, SensitiveKeysFilter) live in `utils/infrastructure/observability/`. Wiring builds the logger chain: **PinoAdapter → SensitiveKeysFilter → SafeLogger**.

### Logger port and SafeLogger

- **Interface**: `ILogger` in `utils/kernel/observability/logger.port.ts`. Domain and app must not import Pino; they depend only on the port.
- **SensitiveKeysFilter**: Wraps any `Logger`. Omits any key-value pair whose key is in the sensitive set (exact match, recursive through nested objects). Configured in wiring with keys: `password`, `token`, `authorization`, `secret`, `cookie`, `access_token`, `refresh_token`, `api_key`, `api_key_hash`.
- **SafeLogger**: Wraps any `Logger` so that **under no circumstance does a logger failure stop execution**. Exceptions inside the logger are caught; only `fatal()` is allowed to terminate the process. Do not rely on the logger for control flow.

**Standard methods** (all take `ctx: AppContext`, `msg: string`, optional `extras?: Record<string, unknown>`):

- `debug`, `info`, `warn`, `error`, `fatal`
- `with(key, value): Logger` — returns a child logger that adds that key-value to every subsequent event

**Canonical log methods**:

- `addCanonicalMeta(ctx, entries)` — add key-value pairs to the request's canonical accumulator.
- `incrementCanonical(ctx, key, delta)`, `decrementCanonical(ctx, key, delta)` — update counters.
- `dispatchCanonicalDebug/Info/Warn/Error(ctx, msg)` — emit one log with accumulated meta/counters, then clear. **Do not** call these from handlers; the middleware dispatches once at the end of every request.

### Mandatory context fields

Every log event includes these fields, read from `AppContext`:

- **tracking_id** — UUID v7 per request (set by `trackingCanonical` middleware).
- **platform_id** — Authenticated platform (set by `apiKeyAuth` middleware, when present).
- **start_ts** — Request start time (Unix ms), set by `trackingCanonical`.

On **canonical dispatch**, the adapter also adds:

- **end_ts**, **duration_ms**, **canonical_meta**, **canonical_counters**.

Always pass the `AppContext` (built via `buildAppContext(c)`) so these fields are included.

### Log level policy

**Production goal: full traceability.** Every request must be reconstructable from logs alone. When something fails at 3 AM, the on-call engineer should be able to follow the `tracking_id` through every layer (HTTP → app handler → adapter → DB) and understand exactly what happened without attaching a debugger.

| Level | When to use | Examples |
|-------|-------------|----------|
| **debug** | Entry/exit of every significant operation. Input parameters, computed intermediate values, adapter calls. In production, `debug` may be disabled — but the code must always emit them so they can be enabled on demand. | Handler start with command params, balance checks (cached, holds, available), adapter queries (findById, save), transaction begin/commit/rollback. |
| **info** | Successful completion of a business operation, or noteworthy but non-error events that are always relevant in production. | Deposit success, wallet created, system wallet auto-created, hold expired on-access (not an error — expected domain behavior). |
| **warn** | Something unexpected happened but the request can still continue, or a client error that may indicate a bug in the caller. | Validation failures (malformed JSON, Zod errors), optimistic locking version conflict (retry expected), hold expired when client tried to capture. |
| **error** | An operation failed and the request cannot complete successfully. Server-side errors (5xx), infrastructure failures, unexpected exceptions. | Prisma connection failure, unhandled exception in handler (caught by global `onError`), any `AppError` with Kind = Internal. |
| **fatal** | The process cannot continue and must shut down. | Failed to bind port, database connection pool exhausted on startup, corrupt configuration. |

**Rules:**

1. **Always log at handler entry** (`debug`): log the command/query parameters so every request is traceable from the start.
2. **Always log at handler success** (`info`): log the outcome (created IDs, affected entities) so the audit trail is complete.
3. **Always log on early returns** (`warn` or `info`): if a handler returns early (validation failure, not-found, domain rule violation), there must be a log so the request doesn't "vanish" from observability.
4. **Always log business-critical intermediate values** (`debug`): balance checks, hold sums, version numbers — anything that feeds a decision. When a production bug manifests as "wrong balance", these logs are the first thing we check.
5. **Adapter methods must log their calls** (`debug`): every DB query should be traceable. Include the entity ID or key filter so we can correlate with slow-query logs.
6. **Never log sensitive data**: the `SensitiveKeysFilter` handles known keys, but be mindful of extras — never log full request bodies containing PII, tokens, or credentials.
7. **Client errors (4xx) are `warn`, not `error`**: a validation failure is the client's fault, not ours. Reserve `error` for things that page the on-call team.

### Log tag convention

**This must be applied across the entire backend. Every file that logs must define mainLogTag and methodLogTag.**

1. **Per file**: Define a const for the component (the main log tag):
   - `const mainLogTag = "DepositHandler";`
   - `const mainLogTag = "WalletRepo";`

2. **Per method**: Define `methodLogTag` concatenating main tag + method name:
   - `` const methodLogTag = `${mainLogTag} | handle`; `` → `"DepositHandler | handle"`

3. **Messages**: Every log message must **start with** `methodLogTag`:
   - `` logger.info(ctx, `${methodLogTag} deposit success`); ``

4. **Never pass the log tag as a parameter** to other functions. It is always a local const.

### Canonical logs

- **Purpose**: Summary at the end of each request (used sparingly).
- `trackingCanonical` middleware injects the `CanonicalAccumulator` into context. Handlers may call `addCanonicalMeta`, `incrementCanonical`. When the request ends (success or error), the middleware dispatches `dispatchCanonicalInfo(ctx, "Canonical log | request completed")`.
- Handlers do not call `dispatchCanonical*`; the middleware does it once per request.

---

## Middleware (utils/middleware/)

### Global middleware (registered on all routes in `index.ts`)

| Middleware | Responsibility |
|------------|----------------|
| **trackingCanonical** | Generate tracking_id (UUID v7), inject request start, canonical accumulator; dispatch canonical on exit. |
| **requestResponseLog** | Log every request (method, path, body) and response (status, duration). Reads body via `c.req.raw.clone()` to avoid consuming the stream for downstream handlers. |

### Route-group middleware (registered per route group in route files)

| Middleware | Responsibility |
|------------|----------------|
| **apiKeyAuth** | Validate API key, inject platform_id into context. Applied to all non-health routes. |
| **idempotency** | Atomic acquire-then-complete pattern for `Idempotency-Key` header. Applied to mutation endpoints only. Returns `409 IDEMPOTENCY_KEY_IN_PROGRESS` if another request is processing the same key. |

**Why the split?** `trackingCanonical` and `requestResponseLog` apply to everything including `/health`. `apiKeyAuth` and `idempotency` only apply to authenticated, mutation-capable routes — registering them globally would break health checks and GET endpoints.

---

## Scheduled Jobs (Inbound Adapters)

Scheduled jobs (cron) are **inbound adapters**, the same category as HTTP routes. The scheduler dispatches commands via the `CommandBus`, following the same pattern as HTTP routes dispatching commands.

| Job | Location | Interval | Description |
|-----|----------|----------|-------------|
| **expireHolds** | `wallet/infrastructure/adapters/inbound/scheduler/expireHolds.job.ts` | 30s | Marks zombie holds (status='active', expires_at < now) as 'expired' via CommandBus |
| **cleanupIdempotency** | `common/idempotency/infrastructure/adapters/inbound/scheduler/cleanupIdempotency.job.ts` | 60s | Deletes expired idempotency records via CommandBus |

The scheduler infrastructure lives in `utils/infrastructure/scheduler.ts` (`startScheduledJobs`). Each BC or common feature registers its own jobs.

---

## Concurrency

- **Optimistic locking**: All wallet mutations (single and multi-wallet). On version mismatch → `409 VERSION_CONFLICT`; client retries with same idempotency key. No server-side retry.
- **Idempotency keys**: All mutations. Atomic acquire pattern (INSERT pending → execute → complete). See `systemPatterns.md`.
- **DB constraints**: Uniqueness, referential integrity, positive amounts as safety net.

**No `SELECT FOR UPDATE`**: We use optimistic locking instead of pessimistic locking for all operations, including multi-wallet (transfers, hold capture). Pessimistic locking (`SELECT FOR UPDATE`) is a SQL-specific concept that would leak infrastructure details into the domain port. The `version` field is database-agnostic and catches all conflicts. See `systemPatterns.md` § "Why optimistic locking, not SELECT FOR UPDATE" for full rationale.

---

## BigInt Serialization

Prisma `BigInt` fields return native `bigint` which does not serialize to JSON. Use `utils/kernel/bigint.ts`:

- `toSafeNumber(value)` — returns `number` if safe, `string` if exceeds `MAX_SAFE_INTEGER`.
- `toNumber(value)` — unconditional cast to `number`; use for timestamps and small amounts.
- `bigIntReplacer` — JSON.stringify replacer for quick Prisma result serialization.

Adapters and read stores must convert BigInt values before returning DTOs. Never expose raw `bigint` in API responses.

---

## AppContext Helper

Use `buildAppContext(c)` from `utils/infrastructure/hono.context.ts` to construct `AppContext` from Hono context in HTTP handlers. Avoids repeating `c.get()` boilerplate:

```typescript
import { buildAppContext } from "utils/infrastructure/hono.context.js";
const ctx = buildAppContext(c);
```

For non-HTTP flows (background jobs, scripts, tests, domain events), use `createAppContext(idGen)` from `utils/kernel/context.ts`. It generates a fresh `trackingId`, sets `startTs = Date.now()`, and creates a new `CanonicalAccumulator`:

```typescript
import { createAppContext } from "utils/kernel/context.js";
const ctx = createAppContext(idGen);
```

---

## Double-Entry Ledger

- Every financial operation produces **2 entries** (debit + credit).
- **ledger_entries** is immutable: DB trigger prevents UPDATE/DELETE; `prisma/immutable_ledger.sql` applied after migrations.
- `entry_type`: CREDIT or DEBIT; `amount_cents` signed (+ credit, - debit).
- `balance_after_cents` stores running balance snapshot.

---

## Implementation Patterns

Concrete TypeScript patterns for implementing domain, app, and adapter layers. These are the canonical reference for how each layer should be structured.

### Aggregate structure

Aggregates encapsulate state and enforce invariants. Fields are **private** (`#` or `private`); external access through **getters only**. No setters — mutations happen through domain methods that validate rules.

Two construction paths:
- **`create()`** — for new aggregates. Validates input, sets defaults.
- **`reconstruct()`** — for loading from DB. No validation (data already valid). Raw field assignment.

```typescript
// wallet/domain/wallet/aggregate.ts

import { AppError } from "utils/kernel/appError.js";

export class Wallet {
  private readonly _id: string;
  private readonly _ownerId: string;
  private readonly _platformId: string;
  private readonly _currencyCode: string;
  private _cachedBalanceCents: bigint;
  private _status: string;
  private _version: number;
  private readonly _isSystem: boolean;
  private _createdAt: number;
  private _updatedAt: number;

  private constructor() {} // Force usage of create/reconstruct

  // --- Factory: new aggregate ---
  static create(
    id: string,
    ownerId: string,
    platformId: string,
    currencyCode: string,
    isSystem: boolean,
    now: number,
  ): Wallet {
    const w = new Wallet();
    Object.assign(w, {
      _id: id, _ownerId: ownerId, _platformId: platformId,
      _currencyCode: currencyCode.toUpperCase(),
      _cachedBalanceCents: 0n, _status: "active", _version: 0,
      _isSystem: isSystem, _createdAt: now, _updatedAt: now,
    });
    return w;
  }

  // --- Factory: load from DB (no validation) ---
  static reconstruct(
    id: string, ownerId: string, platformId: string, currencyCode: string,
    cachedBalanceCents: bigint, status: string, version: number,
    isSystem: boolean, createdAt: number, updatedAt: number,
  ): Wallet {
    const w = new Wallet();
    Object.assign(w, {
      _id: id, _ownerId: ownerId, _platformId: platformId,
      _currencyCode: currencyCode, _cachedBalanceCents: cachedBalanceCents,
      _status: status, _version: version, _isSystem: isSystem,
      _createdAt: createdAt, _updatedAt: updatedAt,
    });
    return w;
  }

  // --- Getters ---
  get id(): string { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get platformId(): string { return this._platformId; }
  get currencyCode(): string { return this._currencyCode; }
  get cachedBalanceCents(): bigint { return this._cachedBalanceCents; }
  get status(): string { return this._status; }
  get version(): number { return this._version; }
  get isSystem(): boolean { return this._isSystem; }
  get createdAt(): number { return this._createdAt; }
  get updatedAt(): number { return this._updatedAt; }

  // --- Domain methods (mutations with invariant checks) ---

  deposit(amountCents: bigint, now: number): void {
    if (this._status !== "active") throw ErrWalletNotActive(this._id);
    if (amountCents <= 0n) throw ErrInvalidAmount();
    this._cachedBalanceCents += amountCents;
    this.touch(now);
  }

  withdraw(amountCents: bigint, availableBalanceCents: bigint, now: number): void {
    if (this._status !== "active") throw ErrWalletNotActive(this._id);
    if (amountCents <= 0n) throw ErrInvalidAmount();
    if (!this._isSystem && availableBalanceCents < amountCents) {
      throw ErrInsufficientFunds(this._id);
    }
    this._cachedBalanceCents -= amountCents;
    this.touch(now);
  }

  freeze(now: number): void {
    if (this._isSystem) throw ErrCannotFreezeSystemWallet();
    if (this._status === "closed") throw ErrWalletClosed(this._id);
    this._status = "frozen";
    this.touch(now);
  }

  // --- Private helper: update updatedAt on every mutation ---
  private touch(now: number): void {
    this._updatedAt = now;
  }
}

// --- Domain error factories (wallet/domain/wallet/errors.ts) ---

function ErrWalletNotActive(walletId: string) {
  return AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${walletId} is not active`);
}
function ErrInsufficientFunds(walletId: string) {
  return AppError.domainRule("INSUFFICIENT_FUNDS", `wallet ${walletId} has insufficient funds`);
}
function ErrInvalidAmount() {
  return AppError.validation("INVALID_AMOUNT", "amount must be positive");
}
function ErrCannotFreezeSystemWallet() {
  return AppError.domainRule("CANNOT_FREEZE_SYSTEM_WALLET", "system wallets cannot be frozen");
}
function ErrWalletClosed(walletId: string) {
  return AppError.domainRule("WALLET_CLOSED", `wallet ${walletId} is closed`);
}
```

**Why `reconstruct()` exists**: When loading from DB, data is already valid (it passed validation on creation). Re-validating wastes cycles and risks false rejections if validation rules evolved since the record was created.

**Why private fields + getters**: Prevents external code from mutating state without going through domain methods that enforce invariants. TypeScript's `private` keyword is compile-time only but signals intent clearly.

**Why `touch()`**: Every mutation updates `updatedAt`. Centralizing this in a private helper prevents forgetting it when adding new domain methods.

---

### Domain error factories

Each bounded context defines its errors in a dedicated file (`domain/<aggregate>/errors.ts`). Errors are **functions returning `AppError`**, not classes or constants. This allows parameterized messages while keeping stable codes.

```typescript
// wallet/domain/wallet/errors.ts

import { AppError } from "utils/kernel/appError.js";

// Domain rule violations → 422
export const ErrInsufficientFunds = (walletId: string) =>
  AppError.domainRule("INSUFFICIENT_FUNDS", `wallet ${walletId} has insufficient available funds`);

export const ErrWalletNotActive = (walletId: string) =>
  AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${walletId} is not active`);

export const ErrWalletClosed = (walletId: string) =>
  AppError.domainRule("WALLET_CLOSED", `wallet ${walletId} is closed`);

export const ErrCannotFreezeSystemWallet = () =>
  AppError.domainRule("CANNOT_FREEZE_SYSTEM_WALLET", "system wallets cannot be frozen");

// Validation errors → 400
export const ErrInvalidAmount = () =>
  AppError.validation("INVALID_AMOUNT", "amount must be positive");

export const ErrInvalidCurrency = (code: string) =>
  AppError.validation("INVALID_CURRENCY", `invalid currency code: ${code}`);

// Conflict errors → 409
export const ErrWalletAlreadyExists = () =>
  AppError.conflict("WALLET_ALREADY_EXISTS", "wallet already exists for this owner/platform/currency");

export const ErrVersionConflict = () =>
  AppError.conflict("VERSION_CONFLICT", "wallet was modified by another request; retry with same idempotency key");

// Not found → 404
export const ErrWalletNotFound = (walletId: string) =>
  AppError.notFound("WALLET_NOT_FOUND", `wallet ${walletId} not found`);
```

**Why functions, not constants**: Constants like `const ErrNotFound = AppError.notFound(...)` create a single shared instance. If the message needs the wallet ID, you'd need a new instance each time. Functions solve this while keeping the error code stable.

**Why functions, not classes**: Arrow functions returning `AppError` are the idiomatic TypeScript way to create parameterized errors. They keep stable codes while allowing per-instance messages.

---

### Repository port (write store)

Repository ports live in `wallet/domain/ports/`. They accept and return **aggregates**, not DTOs. **All methods receive `ctx: AppContext` as first parameter**, enabling adapters to log with full request traceability. Single `save()` method for both insert and update (upsert pattern).

```typescript
// wallet/domain/ports/wallet.repository.ts

import type { AppContext } from "utils/kernel/context.js";
import type { Wallet } from "../wallet/wallet.aggregate.js";

export interface IWalletRepository {
  save(ctx: AppContext, wallet: Wallet): Promise<void>;
  findById(ctx: AppContext, walletId: string): Promise<Wallet | null>;
  findSystemWallet(ctx: AppContext, platformId: string, currencyCode: string): Promise<Wallet | null>;
  // ...
}
```

**Why `ctx` as first parameter**: Adapters receive `ILogger` in their constructor and use `ctx` to log with `tracking_id` and `platform_id` on every operation. When inside a transaction, `ctx.opCtx` carries the opaque transaction handle — the adapter inspects it internally to choose the right DB client. This keeps the domain layer transport-agnostic (it defines `AppContext`, not HTTP headers) while giving adapters full observability.

**Why a single `save()`**: Uses `INSERT ... ON CONFLICT DO UPDATE` (upsert). The handler doesn't care if the aggregate is new or existing — one method handles both cases.

---

### Repository adapter (Prisma)

The adapter implements the port using Prisma. It receives `ILogger` in the constructor for traceability, maps between aggregate and Prisma model, and handles **optimistic locking** via `version`.

```typescript
// wallet/infrastructure/adapters/outbound/prisma/wallet.repo.ts

import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "utils/kernel/context.js";
import type { ILogger } from "utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../../domain/ports/wallet.repository.js";

export class PrismaWalletRepo implements IWalletRepository {
  constructor(private readonly prisma: PrismaClient, private readonly logger: ILogger) {}

  async save(wallet: Wallet): Promise<void> {
    const methodLogTag = `${mainLogTag} | save`;

    // Upsert with optimistic locking: version must match on update
    const result = await this.prisma.wallet.upsert({
      where: { id: wallet.id },
      data: { /* create fields */ },
    });
    } else {
      // Optimistic locking: WHERE id AND version must match
      const result = await db.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: {
          cachedBalanceCents: wallet.cachedBalanceCents,
          status: wallet.status,
          version: wallet.version + 1,
          updatedAt: BigInt(wallet.updatedAt),
        },
      });
      if (result.count === 0) throw ErrVersionConflict();
    }
  }

  async findById(ctx: AppContext, walletId: string): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  // --- Map Prisma row → domain aggregate (Reconstruct, no validation) ---
  private toDomain(row: {
    id: string; ownerId: string; platformId: string; currencyCode: string;
    cachedBalanceCents: bigint; status: string; version: number;
    isSystem: boolean; createdAt: bigint; updatedAt: bigint;
  }): Wallet {
    return Wallet.reconstruct(
      row.id, row.ownerId, row.platformId, row.currencyCode,
      row.cachedBalanceCents, row.status, row.version,
      row.isSystem, Number(row.createdAt), Number(row.updatedAt),
    );
  }
}
```

**Why `toDomain()` uses `reconstruct()`**: Data from DB is already valid. `reconstruct()` skips validation and directly assigns fields. This avoids re-running domain checks on data that was validated at creation time.

---

### Command use case (Load-Mutate-Save)

Command use cases orchestrate the flow: load aggregate → call domain methods → persist changes. They depend **only on interfaces** (ports). No Prisma, no Hono.

```typescript
// wallet/application/command/deposit/usecase.ts

import type { AppContext } from "utils/kernel/context.js";
import type { IIDGenerator } from "utils/application/id.generator.js";
import type { ILogger } from "utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/errors.js";

const mainLogTag = "DepositHandler";

export class DepositHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: DepositCommand): Promise<DepositResult> {
    const methodLogTag = `${mainLogTag} | handle`;
    this.logger.debug(ctx, `${methodLogTag} start`, { wallet_id: cmd.walletId });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();

    // All writes inside a single DB transaction
    await this.txManager.run(ctx, async (txCtx) => {
      // 1. Load aggregate (ctx passed to all repo methods)
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) throw ErrWalletNotFound(cmd.walletId);

      // 2. Load system wallet (counterparty)
      const systemWallet = await this.walletRepo.findSystemWallet(
        txCtx, wallet.platformId, wallet.currencyCode,
      );
      if (!systemWallet) throw ErrSystemWalletNotFound(...);

      // 3. Mutate aggregate (domain validates invariants)
      const now = Date.now();
      wallet.deposit(cmd.amountCents, now);

      // 4. Create movement + transaction + ledger entries
      const movement = Movement.create({ id: movementId, type: "deposit", createdAt: now });
      const tx = Transaction.create({ id: txId, walletId: wallet.id, ... });
      const [userEntry, systemEntry] = LedgerEntry.createPair({ ... });

      // 5. Save user wallet (optimistic locking), system wallet (atomic increment)
      await this.walletRepo.save(txCtx, wallet);
      await this.walletRepo.adjustSystemWalletBalance(txCtx, systemWallet.id, -cmd.amountCents, now);
      await this.movementRepo.save(txCtx, movement);
      await this.transactionRepo.save(txCtx, tx);
      await this.ledgerEntryRepo.saveMany(txCtx, [userEntry, systemEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} deposit success`, {
      wallet_id: cmd.walletId, transaction_id: txId,
    });

    // Return minimal data (ID only — not the full wallet)
    return { transactionId: txId, movementId };
  }
}
```

**Why the handler doesn't import Prisma**: The handler depends on `IWalletRepository` (interface). Prisma is an implementation detail injected at wiring time. This keeps the app layer testable (mock the interface) and framework-independent.

**Why commands return minimal data**: Strict CQRS says commands return nothing. Pragmatically, returning the created ID avoids an unnecessary follow-up query. Never return the full aggregate or a rich DTO — that's the query side's job.

---

### Query use case + ReadStore

Query use cases return **DTOs**, not aggregates. They use a `ReadStore` port optimized for reads (can use JOINs, aggregations).

```typescript
// wallet/application/query/getWallet/usecase.ts

import { AppError } from "utils/kernel/appError.js";
import type { AppContext } from "utils/kernel/context.js";
import type { ILogger } from "utils/kernel/observability/logger.port.js";
import type { IWalletReadStore } from "../../ports/wallet.readstore.js";

const mainLogTag = "GetWalletHandler";

export class GetWalletHandler {
  constructor(
    private readonly readStore: IWalletReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetWalletQuery): Promise<WalletDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    const dto = await this.readStore.getById(query.walletId, query.platformId);
    if (!dto) {
      this.logger.info(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }
    return dto;
  }
}
```

**Why no aggregate loading**: Queries don't need invariant enforcement. Loading an aggregate, calling getters, and mapping to a DTO is wasteful. The ReadStore adapter runs an optimized query (with JOINs, computed fields like `available_balance`) and returns the DTO directly. This is the CQRS read-side pattern: separate read model from write model.

---

### HTTP handler (inbound adapter)

HTTP handlers live in `wallet/infrastructure/adapters/inbound/http/<endpoint>/`. They parse the request, validate format, dispatch the command/query via the bus, and map the result to an HTTP response.

```typescript
// wallet/infrastructure/adapters/inbound/http/deposit/handler.ts

import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { validationHook } from "utils/infrastructure/hono.error.js";
import { buildAppContext, handlerFactory } from "utils/infrastructure/hono.context.js";
import type { ICommandBus } from "utils/application/cqrs.js";

const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });
const BodySchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
});

export function depositRoute(commandBus: ICommandBus) {
  return handlerFactory.createHandlers(
    zValidator("param", ParamSchema, validationHook),
    zValidator("json", BodySchema, validationHook),
    async (c) => {
      const { walletId } = c.req.valid("param");
      const data = c.req.valid("json");
      const ctx = buildAppContext(c);

      const result = await commandBus.dispatch(ctx, {
        walletId,
        amountCents: BigInt(data.amount_cents),
        reference: data.reference,
        idempotencyKey: c.req.header("idempotency-key")!,
        platformId: ctx.platformId!,
      });

      return c.json(
        { transaction_id: result.transactionId, movement_id: result.movementId },
        201,
      );
    },
  );
}
```

**Why Zod is OK here**: Zod lives in the HTTP adapter (inbound adapter), not in domain or app. The HTTP handler validates request **format** (is it a number? is it positive?). Domain validates **business rules** (is the wallet active? sufficient funds?). Format validation and business validation are separate concerns — the adapter handles the former, the domain handles the latter.

**Why `handlerFactory.createHandlers()`**: Hono's `createFactory` preserves type inference through the middleware chain — `c.req.valid("json")` and `c.req.valid("param")` are fully typed without casts. Validators and handler are composed in a single call. No try/catch needed — errors propagate to the global `onError` in `index.ts`, which maps `AppError.kind` → HTTP status via `errorResponse()`.

---

### Route registration (routes.ts)

Each route group has a routes file colocated with the bounded context. Route-group middleware (apiKeyAuth, idempotency) is registered here, not globally. Routes receive `commandBus` / `queryBus` from wiring.

```typescript
// wallet/infrastructure/adapters/inbound/http/wallets.routes.ts

import { Hono } from "hono";
import type { HonoVariables } from "utils/infrastructure/hono.context.js";
import { depositRoute } from "./deposit/handler.js";
import { getWalletRoute } from "./getWallet/handler.js";
import type { ICommandBus } from "utils/application/cqrs.js";
import type { IQueryBus } from "utils/application/cqrs.js";
import { apiKeyAuth } from "utils/middleware/apiKeyAuth.js";
import { idempotency } from "utils/middleware/idempotency.js";

export function walletRoutes(commandBus: ICommandBus, queryBus: IQueryBus, deps: Dependencies) {
  const router = new Hono<{ Variables: HonoVariables }>();
  const auth = apiKeyAuth(deps.validateApiKey);
  const idemp = idempotency(deps.idempotencyStore);

  router.post("/:walletId/deposit", auth, idemp, ...depositRoute(commandBus));
  router.get("/:walletId", auth, ...getWalletRoute(queryBus));

  return router;
}
```

**Why wiring happens in wiring.ts**: All repos and use case handlers are instantiated once in `wiring.ts`, registered on the command/query buses, and the buses are passed to route files. Route files only do routing — no imports of repos, no `new Handler(...)`. This eliminates duplicate repo instantiation across route groups.

---

### Prisma transactions

Use `prisma.$transaction()` when multiple writes must be atomic (e.g., deposit: update wallet + create transaction + create ledger entries).

```typescript
// Inside command use case or repository adapter:
await prisma.$transaction(async (tx) => {
  // All operations inside use `tx`, not `prisma`
  await tx.wallet.update({ where: { id: walletId, version: expectedVersion }, data: { ... } });
  await tx.transaction.create({ data: { ... } });
  await tx.ledgerEntry.createMany({ data: [debitEntry, creditEntry] });
});
```

**When to use transactions:**
- **Always** for deposit, withdraw, transfer, hold capture (multiple table writes)
- **Not needed** for single reads (queries)
- **Not needed** for wallet creation (single insert, idempotent via unique constraint)

**No SELECT FOR UPDATE**: Multi-wallet operations (transfers, hold capture) rely on optimistic locking via the `version` field, not pessimistic row locks. This keeps the domain layer database-agnostic. See `systemPatterns.md` § "Why optimistic locking, not SELECT FOR UPDATE" for the architectural rationale. If pessimistic locking becomes necessary under high contention, it can be added inside the Prisma adapter as an implementation detail without changing domain ports.

---

## References

- [domain.md](../domain.md) — Business rules and flows
- [datamodel.md](../datamodel.md) — Entities and relationships
