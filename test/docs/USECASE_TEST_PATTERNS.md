# Use Case Test Patterns

> How to test command and query use cases in `src/wallet/application/`. Mocked ports, verified orchestration.

---

## Principles

1. **Mock every port** with `mock<Interface>()` from vitest-mock-extended.
2. **Reset all mocks** in `beforeEach` with `mockReset(mockObj)`.
3. **Verify every throw** in the use case source has a corresponding test.
4. **Verify repo calls**: argument correctness, call count, call order.
5. **Use builders** (`WalletBuilder`, `HoldBuilder`) for test data, not raw `reconstruct()`.
6. **Use `createMockTransactionManager()`** -- it passes through the callback immediately.
7. **Use `createMockIDGenerator(ids)`** with the exact sequence of IDs the use case generates.

---

## Copy-Paste Template: Command Use Case Test

```ts
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
  createMockTransactionManager,
} from "../../helpers/mocks/index.js";
import { WalletBuilder } from "../../helpers/builders/wallet.builder.js";
import { createTestContext } from "../../helpers/builders/context.builder.js";
import { MyUseCase } from "@/wallet/application/command/myAction/usecase.js";
import { MyCommand } from "@/wallet/application/command/myAction/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

describe("MyUseCase", () => {
  // ── Mock setup ────────────────────────────────────────────────────
  const walletRepo = mock<IWalletRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();

  // ── System Under Test ─────────────────────────────────────────────
  const sut = new MyUseCase(
    txManager,
    walletRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );

  // ── Shared context ────────────────────────────────────────────────
  const ctx = createTestContext();

  // ── Reset before each test ────────────────────────────────────────
  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen.reset();
  });

  // ── Happy path ────────────────────────────────────────────────────
  describe("Given a valid wallet and system wallet exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(10000n)
          .build(),
      );
      walletRepo.findSystemWallet.mockResolvedValue(
        new WalletBuilder()
          .withId("system-wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(500000n)
          .asSystem()
          .build(),
      );
      walletRepo.save.mockResolvedValue(undefined);
      walletRepo.adjustSystemWalletBalance.mockResolvedValue(undefined);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
    });

    describe("When executing the command", () => {
      const cmd = new MyCommand("wallet-1", "platform-1", 5000n, "idem-1");

      it("Then it returns the expected result", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the wallet is saved with updated balance", async () => {
        await sut.handle(ctx, cmd);
        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceCents).toBe(15000n);
      });

      it("Then a Transaction is created with correct fields", async () => {
        await sut.handle(ctx, cmd);
        expect(transactionRepo.save).toHaveBeenCalledOnce();
        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.type).toBe("deposit");
        expect(tx.status).toBe("completed");
      });

      it("Then two LedgerEntries are created", async () => {
        await sut.handle(ctx, cmd);
        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);
      });
    });
  });

  // ── Error: wallet not found ───────────────────────────────────────
  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When executing the command", () => {
      const cmd = new MyCommand("nonexistent", "platform-1", 1000n, "idem-2");

      it("Then it throws WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  // ── Error: platform mismatch ──────────────────────────────────────
  describe("Given a wallet belonging to a different platform", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-other")
          .withCurrency("USD")
          .build(),
      );
    });

    describe("When executing with platformId 'platform-1'", () => {
      const cmd = new MyCommand("wallet-1", "platform-1", 1000n, "idem-3");

      it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
```

---

## Mock Injection Pattern

Use cases receive dependencies via constructor injection. In tests, pass mocks:

```ts
// Create typed mocks for every port interface
const walletRepo = mock<IWalletRepository>();
const holdRepo = mock<IHoldRepository>();
const transactionRepo = mock<ITransactionRepository>();

// Inject into the use case constructor
const sut = new MyUseCase(
  txManager,       // createMockTransactionManager()
  walletRepo,      // mock<IWalletRepository>()
  holdRepo,        // mock<IHoldRepository>()
  transactionRepo, // mock<ITransactionRepository>()
  idGen,           // createMockIDGenerator(["id-1", "id-2"])
  logger,          // createMockLogger()
);
```

---

## How to Configure Mocks

### Setting return values

```ts
// Single resolved value (used for all calls)
walletRepo.findById.mockResolvedValue(walletInstance);

// Sequential resolved values (different per call)
walletRepo.findById
  .mockResolvedValueOnce(sourceWallet)   // first call
  .mockResolvedValueOnce(targetWallet);  // second call

// Return null (entity not found)
walletRepo.findById.mockResolvedValue(null);

// Void methods
walletRepo.save.mockResolvedValue(undefined);
movementRepo.save.mockResolvedValue(undefined);
```

### Resetting mocks

Always reset in `beforeEach` to prevent state leakage:

```ts
beforeEach(() => {
  mockReset(walletRepo);      // clears calls + implementations + return values
  mockReset(transactionRepo);
  mockReset(ledgerEntryRepo);
  mockReset(movementRepo);
  idGen.reset();               // resets the ID counter back to index 0
});
```

---

## RULE: Every throw/error in the Use Case Source Must Have a Test

Open the use case source file and search for every:
- `throw ErrXxx(...)`
- `throw AppError.xxx(...)`
- `if (!entity) throw ...`
- `if (entity.platformId !== cmd.platformId) throw ...`

**Each one MUST have a corresponding `it("Then throws ...")` in the test file.**

Example audit of `DepositUseCase`:

| Source line | Error thrown | Required test |
|-------------|-------------|---------------|
| `if (!wallet)` | `ErrWalletNotFound` | "Given the wallet does not exist" |
| `if (wallet.platformId !== cmd.platformId)` | `ErrWalletNotFound` | "Given a wallet belonging to a different platform" |
| `if (!systemWallet)` | `ErrSystemWalletNotFound` | "Given the system wallet does not exist" |
| `wallet.deposit(cmd.amountCents, now)` | `WALLET_NOT_ACTIVE` (domain) | "Given a frozen wallet" |

---

## RULE: Verify Repo Save Calls

For every mutation use case, verify:

1. **The correct repo method was called** (`save`, `saveMany`, `adjustSystemWalletBalance`).
2. **The call count is correct** (`toHaveBeenCalledOnce()`, `toHaveBeenCalledTimes(2)`).
3. **The arguments are correct** (extract from `mock.calls` and assert fields).

```ts
it("Then the user wallet balance is updated (original + deposit)", async () => {
  await sut.handle(ctx, cmd);

  // Extract the saved wallet from the mock call
  const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
  expect(savedWallet.cachedBalanceCents).toBe(15000n);
});

it("Then the system wallet balance is adjusted with negative delta", async () => {
  await sut.handle(ctx, cmd);

  expect(walletRepo.adjustSystemWalletBalance).toHaveBeenCalledWith(
    expect.anything(),         // txCtx
    "system-wallet-1",         // systemWalletId
    -5000n,                    // delta (negative for deposit)
    expect.any(Number),        // now timestamp
  );
});
```

---

## How to Test Deadlock Prevention (Transfer Use Case)

The transfer use case saves wallets in **alphabetical ID order** to prevent database deadlocks. Test this explicitly:

```ts
describe("Given source.id > target.id (alphabetically)", () => {
  beforeEach(() => {
    // "wallet-zzz" > "wallet-aaa"
    const source = new WalletBuilder().withId("wallet-zzz").withBalance(10000n).build();
    const target = new WalletBuilder().withId("wallet-aaa").withBalance(5000n).build();

    walletRepo.findById
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(target);
    holdRepo.sumActiveHolds.mockResolvedValue(0n);
  });

  describe("When a transfer is executed", () => {
    it("Then target wallet (lower ID) is saved before source wallet (higher ID)", async () => {
      const cmd = new TransferCommand("wallet-zzz", "wallet-aaa", PLATFORM, 1000n, "idem-1");
      await useCase.handle(ctx, cmd);

      expect(walletRepo.save).toHaveBeenCalledTimes(2);
      const firstSaved = walletRepo.save.mock.calls[0]![1] as Wallet;
      const secondSaved = walletRepo.save.mock.calls[1]![1] as Wallet;
      expect(firstSaved.id).toBe("wallet-aaa");   // lower ID first
      expect(secondSaved.id).toBe("wallet-zzz");  // higher ID second
    });
  });
});
```

---

## Platform Mismatch Pattern

Every use case that receives a `platformId` in the command must verify it matches the wallet's `platformId`. This is a **security guard** against cross-tenant access. Always test it:

```ts
describe("Given a wallet belonging to a different platform", () => {
  beforeEach(() => {
    walletRepo.findById.mockResolvedValue(
      new WalletBuilder()
        .withId("wallet-1")
        .withPlatformId("platform-other")  // different from command's platformId
        .withCurrency("USD")
        .build(),
    );
  });

  describe("When executing with platformId 'platform-1'", () => {
    const cmd = new MyCommand("wallet-1", "platform-1", 1000n, "idem-x");

    it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
      await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
        return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
      });
    });
  });
});
```

Note: The error is `WALLET_NOT_FOUND` (not `PLATFORM_MISMATCH`) intentionally -- we do not leak information about the wallet's existence to a different platform.

---

## The `createMockTransactionManager()` Pass-Through Pattern

The mock transaction manager calls the provided function immediately with the same context:

```ts
// Implementation (from test/helpers/mocks/index.ts):
export function createMockTransactionManager(): ITransactionManager {
  return {
    run: vi.fn(<T>(ctx: AppContext, fn: (txCtx: AppContext) => Promise<T>) => fn(ctx)),
  };
}
```

This means:
- The use case's `this.txManager.run(ctx, async (txCtx) => { ... })` executes synchronously.
- No real database transaction is opened.
- The `txCtx` is the same object as `ctx` (no `opCtx` enrichment).
- All repo calls inside the transaction callback execute against the mocks.

---

## The `createMockIDGenerator()` Pattern

The mock ID generator returns IDs in the order you specify:

```ts
// Will return "tx-1" on first call, "mov-1" on second, etc.
const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);

// IMPORTANT: Count how many times the use case calls idGen.newId()
// and provide exactly that many IDs. If exhausted, it throws an error.

// Reset in beforeEach so each test starts from the first ID:
beforeEach(() => {
  idGen.reset();
});
```

---

## Checklist Before Submitting a Use Case Test

- [ ] Every `throw` / error in the use case source has a corresponding test.
- [ ] Platform mismatch is tested (wallet.platformId !== cmd.platformId).
- [ ] Happy path verifies return value.
- [ ] Happy path verifies all repo save calls (method, count, arguments).
- [ ] Edge cases: minimum amount (1n), boundary values.
- [ ] All mocks are reset in `beforeEach`.
- [ ] `idGen` provides exactly the right number of IDs and is reset in `beforeEach`.
- [ ] `pnpm test:coverage` shows 100% for the use case source file.
