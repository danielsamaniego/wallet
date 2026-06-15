import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ApplyBatchOperationsUseCase } from "@/wallet/application/command/applyBatchOperations/usecase.js";
import {
  ApplyBatchOperationsCommand,
  type BatchOperation,
} from "@/wallet/application/command/applyBatchOperations/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

// ── Shared fixtures ────────────────────────────────────────────────

const PLATFORM = "platform-1";
const CURRENCY = "EUR";
const IDEMPOTENCY_KEY = "idem-batch-1";
const SHARD_COUNT = 32;

function op(
  walletId: string,
  type: BatchOperation["type"],
  amountMinor: bigint,
  reason?: string,
): BatchOperation {
  return { walletId, type, amountMinor, reason };
}

function cmd(
  operations: BatchOperation[],
  opts: {
    allowNegativeBalance?: boolean;
    preserveOperationOrder?: boolean;
    reference?: string;
    metadata?: Record<string, unknown>;
  } = {},
): ApplyBatchOperationsCommand {
  return new ApplyBatchOperationsCommand(
    PLATFORM,
    operations,
    IDEMPOTENCY_KEY,
    SHARD_COUNT,
    opts.allowNegativeBalance ?? false,
    opts.preserveOperationOrder ?? false,
    opts.reference,
    opts.metadata,
  );
}

function savedMovements(repo: ReturnType<typeof mock<IMovementRepository>>): Movement[] {
  return repo.save.mock.calls.map((call) => call[1] as Movement);
}

function savedTransactions(repo: ReturnType<typeof mock<ITransactionRepository>>): Transaction[] {
  return repo.save.mock.calls.map((call) => call[1] as Transaction);
}

function ledgerEntryCount(repo: ReturnType<typeof mock<ILedgerEntryRepository>>): number {
  return repo.saveMany.mock.calls.reduce((n, call) => n + (call[1] as unknown[]).length, 0);
}

describe("ApplyBatchOperationsUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  let idGen: ReturnType<typeof createMockIDGenerator>;
  let useCase: ApplyBatchOperationsUseCase;
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen = createMockIDGenerator();
    holdRepo.sumActiveHolds.mockResolvedValue(0n);
    walletRepo.adjustSystemShardBalance.mockResolvedValue({
      walletId: "system-shard",
      cachedBalanceMinor: 0n,
    });
    useCase = new ApplyBatchOperationsUseCase(
      txManager,
      walletRepo,
      holdRepo,
      transactionRepo,
      ledgerEntryRepo,
      movementRepo,
      idGen,
      logger,
      lockRunner,
    );
  });

  // ── Happy path: settlement-shaped batch on one wallet ──────────

  describe("Given a vendor wallet with a sale credit, a commission charge and a holdback charge", () => {
    function vendor(): Wallet {
      return new WalletBuilder()
        .withId("wallet-vendor")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(0n)
        .build();
    }

    it("Then it returns one movement+transaction per operation in request order", async () => {
      walletRepo.findById.mockResolvedValue(vendor());
      const result = await useCase.handle(
        ctx,
        cmd(
          [
            op("wallet-vendor", "deposit", 10000n, "sale"),
            op("wallet-vendor", "charge", 1500n, "commission"),
            op("wallet-vendor", "charge", 500n, "holdback"),
          ],
          { reference: "settlement-1" },
        ),
      );

      expect(result.operations).toEqual([
        { movementId: "test-id-1", transactionId: "test-id-2" },
        { movementId: "test-id-3", transactionId: "test-id-4" },
        { movementId: "test-id-5", transactionId: "test-id-6" },
      ]);
    });

    it("Then it persists one normal movement + transaction + ledger pair per operation", async () => {
      walletRepo.findById.mockResolvedValue(vendor());
      await useCase.handle(
        ctx,
        cmd([
          op("wallet-vendor", "deposit", 10000n),
          op("wallet-vendor", "charge", 1500n),
          op("wallet-vendor", "charge", 500n),
        ]),
      );

      // One movement, one transaction, one wallet save and one 2-entry ledger
      // write per operation (mirrors the single-op deposit/charge path).
      expect(movementRepo.save).toHaveBeenCalledTimes(3);
      expect(walletRepo.save).toHaveBeenCalledTimes(3);
      expect(transactionRepo.save).toHaveBeenCalledTimes(3);
      expect(savedMovements(movementRepo).map((m) => m.type).sort()).toEqual([
        "charge",
        "charge",
        "deposit",
      ]);
      expect(ledgerEntryCount(ledgerEntryRepo)).toBe(6);
    });

    it("Then exactly one transaction carries the idempotency key and the rest are null", async () => {
      walletRepo.findById.mockResolvedValue(vendor());
      await useCase.handle(
        ctx,
        cmd([op("wallet-vendor", "deposit", 10000n), op("wallet-vendor", "charge", 1500n)]),
      );

      const transactions = savedTransactions(transactionRepo);
      expect(transactions.filter((t) => t.idempotencyKey === IDEMPOTENCY_KEY)).toHaveLength(1);
      expect(transactions.filter((t) => t.idempotencyKey === null)).toHaveLength(1);
    });
  });

  // ── Adjust operations ──────────────────────────────────────────

  describe("Given a settlement batch that includes a positive and a negative adjust", () => {
    it("Then it records adjustment movements with adjustment_credit / adjustment_debit transactions", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-adj")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(0n)
          .build(),
      );

      await useCase.handle(
        ctx,
        cmd([
          op("wallet-adj", "deposit", 10000n, "sale"),
          op("wallet-adj", "adjust", 2000n, "goodwill credit"),
          op("wallet-adj", "adjust", -1500n, "manual correction"),
        ]),
      );

      expect(savedMovements(movementRepo).filter((m) => m.type === "adjustment")).toHaveLength(2);
      const txTypes = savedTransactions(transactionRepo)
        .map((t) => t.type)
        .sort();
      expect(txTypes).toEqual(["adjustment_credit", "adjustment_debit", "deposit"]);
    });
  });

  describe("Given a negative adjust that would overdraw and the platform forbids negatives", () => {
    it("Then it throws INSUFFICIENT_FUNDS", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-adj-poor")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(1000n)
          .build(),
      );

      const err = await useCase
        .handle(
          ctx,
          cmd(
            [
              op("wallet-adj-poor", "adjust", -5000n, "penalty"),
              op("wallet-adj-poor", "charge", 100n, "fee"),
            ],
            { allowNegativeBalance: false },
          ),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "INSUFFICIENT_FUNDS", kind: ErrorKind.DomainRule });
    });
  });

  describe("Given a negative adjust that overdraws and the platform allows negatives", () => {
    it("Then the batch succeeds and the wallet may go negative", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-adj-neg")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(1000n)
          .build(),
      );

      const result = await useCase.handle(
        ctx,
        cmd(
          [
            op("wallet-adj-neg", "adjust", -5000n, "penalty"),
            op("wallet-adj-neg", "deposit", 100n, "extra"),
          ],
          { allowNegativeBalance: true },
        ),
      );

      expect(result.operations).toHaveLength(2);
      expect(movementRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("Given a negative adjust and a charge that together fit but the adjust alone would overdraw", () => {
    it("Then the charge is applied before the negative adjust (deterministic order), so the batch succeeds", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-order")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(1000n)
          .build(),
      );

      // Request order lists the negative adjust FIRST; applied naively it would
      // drive the balance to -1000 and starve the charge. The deterministic
      // order applies the charge first (balance → 0) and the adjust last.
      const result = await useCase.handle(
        ctx,
        cmd(
          [
            op("wallet-order", "adjust", -2000n, "correction"),
            op("wallet-order", "charge", 1000n, "fee"),
          ],
          { allowNegativeBalance: true },
        ),
      );

      expect(result.operations).toHaveLength(2);
      expect(movementRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("Given preserveOperationOrder = true and a debit listed before its funding credit", () => {
    it("Then operations apply in the exact request order, so the debit fails for lack of funds", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-strict")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(0n)
          .build(),
      );

      // charge first (no funds yet), deposit second — preserving order means the
      // charge is NOT reordered after the deposit, so it must fail.
      const err = await useCase
        .handle(
          ctx,
          cmd(
            [
              op("wallet-strict", "charge", 1000n, "fee"),
              op("wallet-strict", "deposit", 10000n, "sale"),
            ],
            { preserveOperationOrder: true },
          ),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "INSUFFICIENT_FUNDS", kind: ErrorKind.DomainRule });
    });
  });

  // ── Credits are applied before debits ──────────────────────────

  describe("Given a wallet with zero balance and operations ordered debit-before-credit", () => {
    it("Then the credit funds the debit and the batch succeeds", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-empty")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(0n)
          .build(),
      );

      const result = await useCase.handle(
        ctx,
        cmd([
          op("wallet-empty", "charge", 4000n, "commission"),
          op("wallet-empty", "deposit", 10000n, "sale"),
        ]),
      );

      expect(result.operations).toHaveLength(2);
      expect(movementRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  // ── Multi-wallet batch ─────────────────────────────────────────

  describe("Given two distinct wallets of the same currency", () => {
    it("Then both wallets are persisted and a movement is created per operation", async () => {
      const a = new WalletBuilder()
        .withId("wallet-a")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(20000n)
        .build();
      const b = new WalletBuilder()
        .withId("wallet-b")
        .withOwnerId("owner-b")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(20000n)
        .build();
      walletRepo.findById.mockImplementation(async (_ctx, id) => (id === "wallet-a" ? a : b));

      await useCase.handle(
        ctx,
        cmd([op("wallet-b", "charge", 1000n), op("wallet-a", "deposit", 1000n)]),
      );

      const savedIds = walletRepo.save.mock.calls.map((c) => (c[1] as Wallet).id).sort();
      expect(savedIds).toEqual(["wallet-a", "wallet-b"]);
      expect(movementRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  // ── Validation: too few operations ─────────────────────────────

  describe("Given a single operation", () => {
    it("Then it throws INVALID_BATCH_OPERATIONS", async () => {
      const err = await useCase
        .handle(ctx, cmd([op("wallet-1", "deposit", 1000n)]))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: "INVALID_BATCH_OPERATIONS", kind: ErrorKind.Validation });
      expect(walletRepo.findById).not.toHaveBeenCalled();
    });
  });

  // ── Wallet not found ───────────────────────────────────────────

  describe("Given an operation referencing a missing wallet", () => {
    it("Then it throws WALLET_NOT_FOUND", async () => {
      walletRepo.findById.mockResolvedValue(null);
      const err = await useCase
        .handle(
          ctx,
          cmd([op("wallet-missing", "deposit", 1000n), op("wallet-missing", "charge", 500n)]),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "WALLET_NOT_FOUND", kind: ErrorKind.NotFound });
    });
  });

  // ── Wallet disappears between pre-flight validation and the lock ───

  describe("Given a wallet validated in the pre-flight that is gone under the lock", () => {
    it("Then it throws WALLET_NOT_FOUND (defensive reload check)", async () => {
      const wallet = new WalletBuilder()
        .withId("wallet-vanish")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(1000n)
        .build();
      // Pre-flight sees it (1 lookup, deduped); the under-lock reload gets null.
      walletRepo.findById.mockResolvedValueOnce(wallet).mockResolvedValue(null);

      const err = await useCase
        .handle(
          ctx,
          cmd([op("wallet-vanish", "deposit", 100n), op("wallet-vanish", "charge", 50n)]),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "WALLET_NOT_FOUND", kind: ErrorKind.NotFound });
    });
  });

  // ── System wallet is not a valid direct target ─────────────────

  describe("Given an operation referencing a system wallet", () => {
    it("Then it throws WALLET_NOT_FOUND", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-system")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .asSystem()
          .build(),
      );
      const err = await useCase
        .handle(
          ctx,
          cmd([op("wallet-system", "deposit", 1000n), op("wallet-system", "charge", 500n)]),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "WALLET_NOT_FOUND", kind: ErrorKind.NotFound });
    });
  });

  // ── Platform mismatch (cross-tenant) ───────────────────────────

  describe("Given an operation referencing a wallet of another platform", () => {
    it("Then it throws WALLET_NOT_FOUND", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-other")
          .withPlatformId("platform-other")
          .withCurrency(CURRENCY)
          .withBalance(10000n)
          .build(),
      );
      const err = await useCase
        .handle(
          ctx,
          cmd([op("wallet-other", "deposit", 1000n), op("wallet-other", "charge", 500n)]),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "WALLET_NOT_FOUND", kind: ErrorKind.NotFound });
    });
  });

  // ── Currency mismatch across operations ────────────────────────

  describe("Given two wallets with different currencies", () => {
    it("Then it throws CURRENCY_MISMATCH", async () => {
      const eur = new WalletBuilder()
        .withId("wallet-eur")
        .withPlatformId(PLATFORM)
        .withCurrency("EUR")
        .withBalance(10000n)
        .build();
      const usd = new WalletBuilder()
        .withId("wallet-usd")
        .withOwnerId("owner-usd")
        .withPlatformId(PLATFORM)
        .withCurrency("USD")
        .withBalance(10000n)
        .build();
      walletRepo.findById.mockImplementation(async (_ctx, id) => (id === "wallet-eur" ? eur : usd));
      const err = await useCase
        .handle(ctx, cmd([op("wallet-eur", "deposit", 1000n), op("wallet-usd", "charge", 500n)]))
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "CURRENCY_MISMATCH", kind: ErrorKind.DomainRule });
    });
  });

  // ── Insufficient funds (a charge would overdraw) ───────────────

  describe("Given the net of the operations would drive the wallet negative via a charge", () => {
    it("Then it throws INSUFFICIENT_FUNDS", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-poor")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(0n)
          .build(),
      );
      const err = await useCase
        .handle(
          ctx,
          cmd([op("wallet-poor", "deposit", 5000n), op("wallet-poor", "charge", 10000n)]),
        )
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "INSUFFICIENT_FUNDS", kind: ErrorKind.DomainRule });
    });
  });

  // ── withdraw operation maps to a withdrawal movement/transaction ─

  describe("Given a withdraw operation alongside a deposit operation", () => {
    it("Then it records a withdrawal and a deposit (movement + transaction)", async () => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-w")
          .withPlatformId(PLATFORM)
          .withCurrency(CURRENCY)
          .withBalance(0n)
          .build(),
      );
      await useCase.handle(
        ctx,
        cmd([op("wallet-w", "deposit", 8000n), op("wallet-w", "withdraw", 3000n)], {
          metadata: { settlementId: "s-1" },
        }),
      );

      expect(savedMovements(movementRepo).map((m) => m.type).sort()).toEqual([
        "deposit",
        "withdrawal",
      ]);
      expect(savedTransactions(transactionRepo).map((t) => t.type).sort()).toEqual([
        "deposit",
        "withdrawal",
      ]);
    });
  });
});
