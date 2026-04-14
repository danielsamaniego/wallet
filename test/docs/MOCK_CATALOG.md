# Mock Catalog

> Complete reference of all mock utilities, builders, and custom matchers available in the test suite.

---

## vitest-mock-extended Primitives

### `mock<T>()`

Creates a deeply typed mock of an interface. Every method is a Vitest `vi.fn()` that returns `undefined` by default.

**Import:**
```ts
import { mock } from "vitest-mock-extended";
```

**Usage:**
```ts
const walletRepo = mock<IWalletRepository>();

// All methods are auto-mocked:
walletRepo.findById;               // vi.fn() -> undefined
walletRepo.save;                   // vi.fn() -> undefined
walletRepo.findSystemWallet;       // vi.fn() -> undefined
walletRepo.adjustSystemWalletBalance; // vi.fn() -> undefined

// Configure return values:
walletRepo.findById.mockResolvedValue(walletInstance);
walletRepo.findById.mockResolvedValueOnce(firstCallResult);
walletRepo.save.mockResolvedValue(undefined);
```

**When to use:** For every port interface (repository, readstore) injected into a use case.

---

### `mockReset(mockObj)`

Resets a mock object: clears all call history, removes all configured return values and implementations. The mock returns `undefined` again.

**Import:**
```ts
import { mockReset } from "vitest-mock-extended";
```

**Usage:**
```ts
beforeEach(() => {
  mockReset(walletRepo);
  mockReset(transactionRepo);
  mockReset(ledgerEntryRepo);
  mockReset(movementRepo);
});
```

**When to use:** In every `beforeEach` to ensure clean state between tests.

---

### `mockClear(mockObj)`

Clears call history and instances but **keeps** configured return values and implementations intact.

**Import:**
```ts
import { mockClear } from "vitest-mock-extended";
```

**When to use:** Rarely. Use `mockReset` instead in almost all cases. Only use `mockClear` when you want to keep the mock configuration but clear the call count (e.g., to re-assert `toHaveBeenCalledOnce()` within nested describes that share mock config).

---

### `mockReset` vs `mockClear` Summary

| Behavior                     | `mockReset` | `mockClear` |
|------------------------------|-------------|-------------|
| Clears `mock.calls`          | Yes         | Yes         |
| Clears `mock.results`        | Yes         | Yes         |
| Clears `mock.instances`      | Yes         | Yes         |
| Removes `.mockReturnValue()` | Yes         | No          |
| Removes `.mockImplementation()` | Yes      | No          |

**Default choice: always use `mockReset` unless you have a specific reason not to.**

---

## Custom Mock Factories

All custom factories live in `test/helpers/mocks/index.ts`.

### `createMockIDGenerator(ids?)`

Creates a mock `IIDGenerator` that returns IDs in sequence.

**Signature:**
```ts
function createMockIDGenerator(ids?: string[]): IIDGenerator & { reset: () => void }
```

**Behavior:**
- If `ids` is provided, returns them in order. Throws if exhausted (requested more IDs than provided).
- If `ids` is omitted, returns `"test-id-1"`, `"test-id-2"`, etc.
- `reset()` resets the counter back to 0 (call in `beforeEach`).
- `newId` is a `vi.fn()`, so you can assert calls.

**Usage:**
```ts
// Provide exact IDs the use case will request:
const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);

// Or let it auto-generate:
const idGen = createMockIDGenerator();
// First call: "test-id-1", second: "test-id-2", etc.

// Reset in beforeEach:
beforeEach(() => {
  idGen.reset();
});
```

**How to determine the ID list:** Open the use case source and count every `this.idGen.newId()` call. Provide exactly that many IDs in the array, in order.

---

### `createMockLogger()`

Creates a no-op `ILogger` where all methods are `vi.fn()`.

**Signature:**
```ts
function createMockLogger(): ILogger
```

**Behavior:**
- `debug`, `info`, `warn`, `error`, `fatal` -- all no-ops.
- `with()` -- returns the same logger instance (chainable).
- `addCanonicalMeta`, `incrementCanonical`, `decrementCanonical` -- no-ops.
- `dispatchCanonicalDebug`, `dispatchCanonicalInfo`, `dispatchCanonicalWarn`, `dispatchCanonicalError` -- no-ops.

**Usage:**
```ts
const logger = createMockLogger();
const sut = new MyUseCase(txManager, walletRepo, ..., logger);

// You can assert logger calls if needed:
expect(logger.warn).toHaveBeenCalledWith(
  expect.anything(),
  expect.stringContaining("wallet not found"),
  expect.anything(),
);
```

---

### `createMockTransactionManager()`

Creates a pass-through `ITransactionManager` that executes the callback immediately.

**Signature:**
```ts
function createMockTransactionManager(): ITransactionManager
```

**Behavior:**
- `run(ctx, fn)` calls `fn(ctx)` immediately and returns its result.
- No real database transaction is opened.
- The `txCtx` passed to `fn` is the same `ctx` object (no `opCtx` enrichment).
- `run` is a `vi.fn()`, so you can assert it was called.

**Usage:**
```ts
const txManager = createMockTransactionManager();
const sut = new MyUseCase(txManager, walletRepo, ...);

// The use case's txManager.run(ctx, async (txCtx) => { ... })
// will execute the inner function synchronously with the same ctx.
```

---

## Builders

All builders live in `test/helpers/builders/` and are re-exported from `test/helpers/builders/index.ts`.

### `WalletBuilder`

Fluent builder that creates `Wallet` instances via `Wallet.reconstruct()`.

**Import:**
```ts
import { WalletBuilder } from "../../helpers/builders/wallet.builder.js";
// or
import { WalletBuilder } from "../../helpers/builders/index.js";
```

**Default values:**
```ts
{
  id: "wallet-1",
  ownerId: "owner-1",
  platformId: "platform-1",
  currencyCode: "USD",
  cachedBalanceCents: 0n,
  status: "active",
  version: 1,
  isSystem: false,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
```

**All methods:**

| Method                   | Effect                                          |
|--------------------------|-------------------------------------------------|
| `.withId(id)`            | Sets wallet ID                                  |
| `.withOwnerId(ownerId)`  | Sets owner ID                                   |
| `.withPlatformId(pid)`   | Sets platform ID                                |
| `.withCurrency(code)`    | Sets currency code (e.g., "USD", "EUR")         |
| `.withBalance(cents)`    | Sets `cachedBalanceCents` (bigint)               |
| `.withStatus(status)`    | Sets status ("active", "frozen", "closed")      |
| `.withVersion(version)`  | Sets optimistic locking version                  |
| `.asSystem()`            | Sets `isSystem: true` and `ownerId: "SYSTEM"`   |
| `.asFrozen()`            | Sets `status: "frozen"`                          |
| `.asClosed()`            | Sets `status: "closed"`                          |
| `.withCreatedAt(ts)`     | Sets `createdAt` timestamp                       |
| `.withUpdatedAt(ts)`     | Sets `updatedAt` timestamp                       |
| `.build()`               | Returns a `Wallet` instance via `reconstruct()`  |

**Usage:**
```ts
const wallet = new WalletBuilder()
  .withId("wallet-1")
  .withPlatformId("platform-1")
  .withCurrency("USD")
  .withBalance(10000n)
  .build();

const systemWallet = new WalletBuilder()
  .withId("system-wallet-1")
  .withPlatformId("platform-1")
  .withCurrency("USD")
  .withBalance(500000n)
  .asSystem()
  .build();

const frozenWallet = new WalletBuilder()
  .withId("wallet-frozen")
  .asFrozen()
  .build();
```

**Important:** `WalletBuilder` is used in **application tests** (use case tests). Domain tests use plain factory functions with `Wallet.reconstruct()` directly.

---

### `HoldBuilder`

Fluent builder that creates `Hold` instances via `Hold.reconstruct()`.

**Import:**
```ts
import { HoldBuilder } from "../../helpers/builders/hold.builder.js";
// or
import { HoldBuilder } from "../../helpers/builders/index.js";
```

**Default values:**
```ts
{
  id: "hold-1",
  walletId: "wallet-1",
  amountCents: 1000n,
  status: "active",
  reference: null,
  expiresAt: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
```

**All methods:**

| Method                     | Effect                                        |
|----------------------------|-----------------------------------------------|
| `.withId(id)`              | Sets hold ID                                  |
| `.withWalletId(walletId)`  | Sets the wallet this hold belongs to           |
| `.withAmount(cents)`       | Sets `amountCents` (bigint)                    |
| `.withStatus(status)`      | Sets status ("active", "captured", "voided", "expired") |
| `.withReference(ref)`      | Sets reference string                          |
| `.withExpiresAt(ts)`       | Sets expiration timestamp                      |
| `.asCaptured()`            | Sets `status: "captured"`                      |
| `.asVoided()`              | Sets `status: "voided"`                        |
| `.asExpired()`             | Sets `status: "expired"`                       |
| `.build()`                 | Returns a `Hold` instance via `reconstruct()`   |

**Usage:**
```ts
const hold = new HoldBuilder()
  .withId("hold-1")
  .withWalletId("wallet-1")
  .withAmount(5000n)
  .withExpiresAt(Date.now() + 60_000)
  .build();

const capturedHold = new HoldBuilder()
  .withId("hold-captured")
  .asCaptured()
  .build();
```

---

### `createTestContext(overrides?)`

Creates a fresh `AppContext` for use in test execution.

**Import:**
```ts
import { createTestContext } from "../../helpers/builders/context.builder.js";
// or
import { createTestContext } from "../../helpers/builders/index.js";
```

**Signature:**
```ts
function createTestContext(overrides?: Partial<AppContext>): AppContext
```

**Default values:**
```ts
{
  trackingId: "test-tracking-id",
  startTs: 1700000000000,
  canonical: new CanonicalAccumulator(),
}
```

**Usage:**
```ts
// Default context (sufficient for most tests):
const ctx = createTestContext();

// With overrides:
const ctx = createTestContext({
  trackingId: "custom-tracking-id",
  platformId: "platform-1",
});
```

---

## Custom Matchers

Defined in `test/helpers/setup.ts` and registered globally via `vitest.config.ts` `setupFiles`.

### `toThrowAppError(kind, code)`

Asserts that a synchronous function throws an `AppError` with the specified `kind` and `code`.

**Signature:**
```ts
expect(fn).toThrowAppError(kind: ErrorKind, code: string)
```

**Usage (synchronous -- domain methods):**
```ts
import { ErrorKind } from "@/utils/kernel/appError.js";

expect(() => wallet.deposit(0n, LATER))
  .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");

expect(() => frozenWallet.freeze(LATER))
  .toThrowAppError(ErrorKind.DomainRule, "WALLET_ALREADY_FROZEN");

expect(() => closedWallet.deposit(100n, LATER))
  .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
```

**IMPORTANT: Does NOT work with async functions.** If you pass an async function, the matcher returns a failure with the message:
> "toThrowAppError does not support async functions."

**For async errors (use case tests), use `rejects.toSatisfy`:**
```ts
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
  return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
});
```

**Alternative async pattern (catch + assert):**
```ts
const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
expect(err).toBeInstanceOf(AppError);
expect(err).toMatchObject({
  code: "CURRENCY_MISMATCH",
  kind: ErrorKind.DomainRule,
});
```

---

## Quick Reference Table

| Utility                          | Location                            | Purpose                              |
|----------------------------------|-------------------------------------|--------------------------------------|
| `mock<T>()`                      | `vitest-mock-extended`              | Create typed mock of interface       |
| `mockReset(obj)`                 | `vitest-mock-extended`              | Full reset (calls + config)          |
| `mockClear(obj)`                 | `vitest-mock-extended`              | Clear calls only (keep config)       |
| `createMockIDGenerator(ids?)`    | `test/helpers/mocks/index.ts`       | Sequential ID generator with reset   |
| `createMockLogger()`             | `test/helpers/mocks/index.ts`       | No-op logger, chainable `.with()`    |
| `createMockTransactionManager()` | `test/helpers/mocks/index.ts`       | Pass-through `run(ctx, fn) => fn(ctx)` |
| `WalletBuilder`                  | `test/helpers/builders/wallet.builder.ts` | Fluent wallet construction     |
| `HoldBuilder`                    | `test/helpers/builders/hold.builder.ts`   | Fluent hold construction       |
| `createTestContext(overrides?)`  | `test/helpers/builders/context.builder.ts` | AppContext for tests          |
| `toThrowAppError(kind, code)`    | `test/helpers/setup.ts`             | Sync-only AppError assertion         |
