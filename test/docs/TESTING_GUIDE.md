# Testing Guide — Wallet Service

> Canonical reference for every AI agent or developer writing tests in this project.
> **Read this file completely before writing any test.**

---

## Philosophy: TDD + BDD + 100% Coverage

This project follows **Test-Driven Development (TDD)** with **Behavior-Driven Development (BDD)** naming:

1. **RED**: Write the test first. It must fail.
2. **GREEN**: Write the minimum code to make it pass.
3. **REFACTOR**: Clean up, then verify tests still pass.

Every test uses BDD structure: `describe("Given X") / describe("When Y") / it("Then Z")`.

**Coverage is 100% — enforced by CI.** If you add code without tests, the build breaks.

---

## Architecture Overview

```
src/                                         # Source code (ZERO test files)
  wallet/
    domain/           → Pure domain logic (aggregates, entities, value objects)
    application/
      command/        → Write use cases (deposit, withdraw, transfer, etc.)
      query/          → Read use cases (getWallet, listHolds, etc.)
    infrastructure/   → Adapters (HTTP handlers, Prisma repos, middleware)
  utils/
    kernel/           → Shared kernel (AppError, AppContext, BigInt, Listing)
    application/      → Cross-cutting interfaces (CQRS, IIDGenerator, ITransactionManager)
    infrastructure/   → Cross-cutting infra (middleware, Hono helpers, logger)

tests/                                       # ALL test files
  unit/                                      # Unit tests (mirror src/ structure)
    wallet/
      domain/         → Aggregate/entity tests (zero mocks)
      application/
        command/      → Command use case tests (mocked ports)
        query/        → Query use case tests (mocked readstores)
      infrastructure/
        http/         → HTTP handler tests
        prisma/       → Prisma repo/readstore tests
        scheduler/    → Job tests
    utils/            → Kernel and infrastructure utility tests
    platform/         → Platform bounded context tests
    common/           → Cross-cutting feature tests (idempotency)
  e2e/                                       # E2E tests (Docker PostgreSQL + Docker App)
    setup/
      global-setup.ts → Starts Docker, applies schema, seeds, starts app
      test-app.ts     → Creates HTTP client against Dockerized app
    wallet/           → E2E test files by security category
  integration/        → (future) DB-level integration tests

test/                                        # Shared test infrastructure
  setup.ts            → Custom Vitest matchers (toThrowAppError)
  helpers/
    builders/         → WalletBuilder, HoldBuilder, createTestContext
    mocks/            → createMockIDGenerator, createMockLogger, createMockTransactionManager
    db.ts             → Prisma test client, truncateAll(), seed helpers
  docs/               → THIS directory — testing documentation for AI agents
```

---

## Test Categories

### 1. Domain Tests (Pure Logic, Zero Mocks)

- **Location:** `tests/unit/wallet/domain/`
- **Imports from:** `@/wallet/domain/` and `@/utils/kernel/` only
- **Mocks:** NONE. Domain logic is pure — no I/O, no dependencies.
- **Purpose:** Verify aggregate invariants, state transitions, validation rules.
- **Rule:** For each aggregate method, build a **state × action → result** matrix and test EVERY cell.
- **Pattern:** See `test/docs/DOMAIN_TEST_PATTERNS.md`

### 2. Use Case Tests (Mocked Ports)

- **Location:** `tests/unit/wallet/application/command/` and `query/`
- **Mocks:** `mock<IWalletRepository>()`, `createMockTransactionManager()`, etc.
- **Purpose:** Verify orchestration: correct repo calls, argument correctness, error propagation, call order.
- **Rule:** Count every `throw` in the use case source — each one MUST have a test.
- **Pattern:** See `test/docs/USECASE_TEST_PATTERNS.md`

### 3. Infrastructure Tests (Mocked Prisma/Hono)

- **Location:** `tests/unit/wallet/infrastructure/`, `tests/unit/utils/infrastructure/`
- **Purpose:** Test adapters, middleware, handlers, repos in isolation.
- **Rule:** Every handler, every middleware branch, every repo method needs a test.

### 4. E2E Tests (Docker — Full Stack)

- **Location:** `tests/e2e/wallet/`
- **Config:** `vitest.e2e.config.ts` (sequential, 30s timeout)
- **Infrastructure:** Docker PostgreSQL (`:5433`) + Docker App (`:3333`), fully isolated from dev.
- **Purpose:** Full HTTP request → middleware → handler → use case → Prisma → PostgreSQL cycle.
- **Rule:** Every endpoint MUST have e2e tests covering the **12 security categories**. See `test/docs/E2E_TEST_PATTERNS.md`.
- **Pattern:** Tests create their own data via API. `app.reset()` truncates + re-seeds between tests.

---

## RULE: 100% Coverage Is Mandatory

Coverage thresholds are enforced in `vitest.config.ts` and `vitest.coverage.config.ts`:

```ts
thresholds: {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
}
```

`pnpm test:coverage` runs BOTH unit + e2e and **fails if any metric drops below 100%**.

This means:
- Every `if` branch needs a test.
- Every `throw` needs a test that triggers it.
- Every public method needs at least one test.
- Every guard clause (null checks, platform mismatches) needs a test.
- Every new file with logic needs a corresponding test file.

**Excluded from coverage** (no runtime code):
- `src/**/ports/**` — pure TypeScript interfaces
- `src/**/*.module.ts` — DI wiring
- `src/index.ts`, `src/wiring.ts`, `src/config.ts` — bootstrap/config
- `src/utils/application/id.generator.ts`, `transaction.manager.ts`, `logger.port.ts` — interfaces

---

## RULE: Exhaustive Test Cases

Every feature MUST have tests for:

1. **Happy path** — the primary success scenario
2. **ALL error paths** — every `throw`, every null guard, every domain rule violation
3. **Edge cases** — boundary values (0, 1, MAX_SAFE_INTEGER, negative, null, empty string)
4. **Security cases** — platform mismatch, cross-tenant access, injection, overflow
5. **Concurrency cases** (e2e) — race conditions, deadlocks, optimistic locking conflicts

**How to audit:** Open the source file, count every `throw` / `AppError.xxx()` / `ErrXxx()` call. Each one MUST have a corresponding test. If it doesn't, add it.

---

## RULE: TDD Workflow

When implementing a new feature or fixing a bug:

1. **Write the test first** — describe the expected behavior in Given/When/Then
2. **Run the test** — it must fail (RED)
3. **Write the minimum code** — make the test pass (GREEN)
4. **Refactor** — clean up, add edge case tests
5. **Verify coverage** — `pnpm test:coverage` must stay at 100%

When modifying existing code:
1. **Run existing tests first** — verify they pass
2. **Add/update tests for the change** — new behavior? new test. Changed behavior? update test.
3. **Implement the change**
4. **Verify all tests pass + coverage 100%**

---

## How to Run Tests

| Command | What it does |
|---------|-------------|
| `pnpm test` | Unit tests only (~1s) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:e2e` | E2E tests — auto-starts Docker PostgreSQL + App (~30s) |
| `pnpm test:coverage` | Unit + E2E combined with 100% coverage enforcement |
| `pnpm test:all` | Unit then E2E sequentially |

---

## How to Add Tests

### For a new domain entity/aggregate method:

1. Open the source file and identify every public method, every `throw`, every branch.
2. Build a state × action matrix (see `DOMAIN_TEST_PATTERNS.md`).
3. Create test at `tests/unit/wallet/domain/<entity>.test.ts`.
4. Write factory functions using `reconstruct()` for arbitrary state.
5. Cover: happy path + every error + every edge case.
6. Run `pnpm test:coverage` — must be 100%.

### For a new command use case:

1. Count every `throw` in the source — each needs a test.
2. Create test at `tests/unit/wallet/application/command/<name>.usecase.test.ts`.
3. Mock all ports with `mock<Interface>()`.
4. Use builders (`WalletBuilder`, `HoldBuilder`) for test data.
5. Cover: happy path + every error + platform mismatch + edge cases.
6. Verify repo save calls: arguments, count, order.
7. Run `pnpm test:coverage` — must be 100%.

### For a new HTTP endpoint:

1. Create handler test at `tests/unit/wallet/infrastructure/http/`.
2. Create e2e tests at `tests/e2e/wallet/` covering ALL 12 security categories.
3. Run `pnpm test:coverage` — must be 100%.

### For a new Prisma repo method:

1. Create/update test at `tests/unit/wallet/infrastructure/prisma/`.
2. Mock PrismaClient with `vitest-mock-extended`.
3. Test the `opCtx` branch (transaction vs default client).
4. Run `pnpm test:coverage` — must be 100%.

---

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Domain test | `tests/unit/wallet/domain/<entity>.test.ts` | `wallet.aggregate.test.ts` |
| Command test | `tests/unit/wallet/application/command/<name>.usecase.test.ts` | `deposit.usecase.test.ts` |
| Query test | `tests/unit/wallet/application/query/<name>.usecase.test.ts` | `getWallet.usecase.test.ts` |
| Handler test | `tests/unit/wallet/infrastructure/http/<name>.test.ts` | `command-handlers.test.ts` |
| Repo test | `tests/unit/wallet/infrastructure/prisma/<name>.test.ts` | `wallet.prisma.test.ts` |
| E2E test | `tests/e2e/wallet/<category>.e2e.test.ts` | `auth.e2e.test.ts` |
| Builder | `test/helpers/builders/<entity>.builder.ts` | `wallet.builder.ts` |
| Mock utility | `test/helpers/mocks/index.ts` | (single barrel file) |
