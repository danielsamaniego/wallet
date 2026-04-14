# Testing Guide -- Wallet Service

> Canonical reference for every AI agent or developer writing tests in this project.

---

## Architecture Overview

This project follows **DDD + Hexagonal Architecture + CQRS**. The test suite mirrors the source layout:

```
src/
  wallet/
    domain/          --> Pure domain logic (aggregates, entities, value objects)
    application/
      command/       --> Write use cases (deposit, withdraw, transfer, etc.)
      query/         --> Read use cases (getWallet, listHolds, etc.)
      ports/         --> Readstore interfaces for queries
    domain/ports/    --> Repository interfaces (outbound ports)
    infrastructure/  --> Adapters (HTTP handlers, Prisma repos, etc.)
  utils/
    kernel/          --> Shared kernel (AppError, AppContext, etc.)
    application/     --> Cross-cutting application abstractions (CQRS, ID generator, tx manager)
    infrastructure/  --> Cross-cutting infra (middleware, Hono helpers)

test/
  domain/            --> Unit tests for aggregates and entities (zero mocks)
  application/
    command/         --> Unit tests for command use cases (mocked ports)
    query/           --> Unit tests for query use cases (mocked readstores)
  e2e/               --> End-to-end tests (Docker + real PostgreSQL)
  helpers/
    builders/        --> WalletBuilder, HoldBuilder, createTestContext
    mocks/           --> createMockIDGenerator, createMockLogger, createMockTransactionManager
    setup.ts         --> Custom Vitest matchers (toThrowAppError)
```

---

## Test Categories

### 1. Domain Tests (Pure)

- **Location:** `test/domain/<aggregate>/<name>.test.ts`
- **Imports from:** `@/wallet/domain/` and `@/utils/kernel/` only
- **Mocks:** NONE. Domain logic is pure -- no I/O, no dependencies.
- **Purpose:** Verify aggregate invariants, state transitions, and validation rules.
- **Example:** `test/domain/wallet/wallet.aggregate.test.ts`

### 2. Application Command Tests (Mocked Ports)

- **Location:** `test/application/command/<name>.usecase.test.ts`
- **Imports from:** Use case class, command DTO, port interfaces, helpers
- **Mocks:** `mock<IWalletRepository>()`, `mock<ITransactionRepository>()`, etc. via vitest-mock-extended
- **Purpose:** Verify orchestration logic: correct repo calls, argument correctness, error propagation, call order.
- **Example:** `test/application/command/deposit.usecase.test.ts`

### 3. Application Query Tests (Mocked Readstores)

- **Location:** `test/application/query/<name>.usecase.test.ts`
- **Imports from:** Query use case, query DTO, readstore interfaces
- **Mocks:** `mock<IWalletReadStore>()`, etc.
- **Purpose:** Verify query delegation, null handling, platform filtering.

### 4. E2E Tests (Docker + Real DB)

- **Location:** `test/e2e/<feature>.e2e.test.ts`
- **Config:** `vitest.e2e.config.ts` (sequential execution, `fileParallelism: false`)
- **Purpose:** Full request lifecycle through HTTP (Hono `app.fetch()`) against real PostgreSQL.
- **Includes:** Security audit categories, concurrency, idempotency, cross-tenant isolation.

---

## RULE: 100% Coverage Is Mandatory

Coverage thresholds are enforced in `vitest.config.ts`:

```ts
thresholds: {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
}
```

`pnpm test:coverage` **will fail** if any metric drops below 100%.

This means:
- Every `if` branch needs a test.
- Every `throw` needs a test that triggers it.
- Every public method needs at least one test.
- Every guard clause (null checks, platform mismatches) needs a test.

---

## RULE: Exhaustividad (Exhaustiveness)

Every feature MUST have tests for:

1. **Happy path** -- the primary success scenario.
2. **ALL error paths** -- every `throw`, every null guard, every domain rule violation.
3. **Edge cases** -- boundary values (0, 1, MAX), exact-match boundaries.
4. **Security cases** -- platform mismatch, cross-tenant access, invalid inputs.

When reviewing a use case source file, count every `throw` / `AppError.xxx()` / `ErrXxx()` call. Each one MUST have a corresponding test.

---

## How to Run Tests

| Command               | What it does                                              |
|-----------------------|-----------------------------------------------------------|
| `pnpm test`           | Run domain + application unit tests once                  |
| `pnpm test:watch`     | Run unit tests in watch mode                              |
| `pnpm test:e2e`       | Run e2e tests (requires Docker PostgreSQL running)        |
| `pnpm test:coverage`  | Run unit tests with v8 coverage, fail if < 100%          |
| `pnpm test:all`       | Run unit tests then e2e tests sequentially                |

---

## How to Add a New Test (Step by Step)

### For a new domain entity/aggregate method:

1. Open the source file (e.g., `src/wallet/domain/wallet/wallet.aggregate.ts`).
2. Identify every public method, every `throw`, every conditional branch.
3. Create/edit the test file at `test/domain/<module>/<entity>.test.ts`.
4. Write factory functions at the top (using `reconstruct()`) that return fresh instances.
5. Structure tests with Given/When/Then (see `BDD_STYLE_GUIDE.md`).
6. Cover: happy path + every error path + edge cases.
7. Run `pnpm test:coverage` to verify 100%.

### For a new command use case:

1. Open the use case source file.
2. Count every `throw` / error -- each needs a test.
3. Create/edit the test file at `test/application/command/<name>.usecase.test.ts`.
4. Set up mocks with `mock<IPortInterface>()`.
5. Use `WalletBuilder` / `HoldBuilder` for test data.
6. Use `createMockTransactionManager()` for the pass-through tx manager.
7. Use `createMockIDGenerator(["id-1", "id-2", ...])` with the exact IDs the use case needs.
8. Reset all mocks in `beforeEach`.
9. Cover: happy path + every error + platform mismatch + edge cases.
10. Verify repo save calls: argument correctness, call count, call order.
11. Run `pnpm test:coverage` to verify 100%.

### For a new e2e endpoint:

1. Create/edit the test file at `test/e2e/<feature>.e2e.test.ts`.
2. Follow the 11 security audit categories (see `E2E_TEST_PATTERNS.md`).
3. Use `createTestApp()` for the Hono app instance.
4. Clean up with `truncateAll()` + `seedTestPlatform()` between tests.
5. Run `pnpm test:e2e`.

---

## File Naming Conventions

| Type             | Pattern                                              | Example                                    |
|------------------|------------------------------------------------------|--------------------------------------------|
| Domain test      | `test/domain/<module>/<entity>.test.ts`              | `test/domain/wallet/wallet.aggregate.test.ts` |
| Command test     | `test/application/command/<name>.usecase.test.ts`    | `test/application/command/deposit.usecase.test.ts` |
| Query test       | `test/application/query/<name>.usecase.test.ts`      | `test/application/query/getWallet.usecase.test.ts` |
| E2E test         | `test/e2e/<feature>.e2e.test.ts`                     | `test/e2e/deposits.e2e.test.ts` |
| Builder          | `test/helpers/builders/<entity>.builder.ts`           | `test/helpers/builders/wallet.builder.ts` |
| Mock utility     | `test/helpers/mocks/index.ts`                         | (single barrel file)                       |
| Setup            | `test/helpers/setup.ts`                               | (custom matchers, global config)           |
