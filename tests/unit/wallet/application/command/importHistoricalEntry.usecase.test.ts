// TODO(historical-import-temp): Remove this test file together with the rest
// of the import-historical-entry feature after migration. Grep for the
// marker to see the full removal scope.
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ImportHistoricalEntryUseCase } from "@/wallet/application/command/importHistoricalEntry/usecase.js";
import { ImportHistoricalEntryCommand } from "@/wallet/application/command/importHistoricalEntry/command.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

describe("ImportHistoricalEntryUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();

  const sut = new ImportHistoricalEntryUseCase(
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

  const ctx = createTestContext();

  // An arbitrary historical moment — September 2024
  const HISTORICAL_AT = 1_726_000_000_000;

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen.reset();
  });

  // ── Positive historical entry ──────────────────────────────────────
  describe("Given an active user wallet and a system wallet exist", () => {
    const systemWallet = new WalletBuilder()
      .withId("system-wallet-1")
      .withPlatformId("platform-1")
      .withCurrency("USD")
      .withBalance(500000n)
      .asSystem()
      .build();

    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(10000n)
          .build(),
      );
      walletRepo.adjustSystemShardBalance.mockImplementation(async (_ctx, _p, _c, _s, delta, _n) => ({
        walletId: systemWallet.id,
        cachedBalanceMinor: systemWallet.cachedBalanceMinor + delta,
      }));
      walletRepo.save.mockResolvedValue(undefined);
      
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
      // Default: no active holds — negative adjustments go through freely.
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
    });

    describe("When importing +5000 cents with a historical timestamp", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        5000n,
        "Legacy promotional credit",
        "Venta producto X",
        "idem-1",
        HISTORICAL_AT,
        32,
        { migratedFrom: "legacy-system" },
      );

      it("Then it returns the transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance is updated (original + imported)", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(15000n);
      });

      it("Then the system wallet balance is adjusted with negative delta at the historical timestamp", async () => {
        await sut.handle(ctx, cmd);

        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledWith(
          expect.anything(),
          "platform-1",
          "USD",
          expect.any(Number),
                    -5000n,
                    HISTORICAL_AT,
        );
      });

      it("Then the Movement carries the historical createdAt and the reason", async () => {
        await sut.handle(ctx, cmd);

        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("adjustment");
        expect(movement.reason).toBe("Legacy promotional credit");
        expect(movement.createdAt).toBe(HISTORICAL_AT);
      });

      it("Then the Transaction carries the historical createdAt, reference and metadata", async () => {
        await sut.handle(ctx, cmd);

        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.walletId).toBe("wallet-1");
        expect(tx.counterpartWalletId).toBe("system-wallet-1");
        expect(tx.type).toBe("adjustment_credit");
        expect(tx.amountMinor).toBe(5000n);
        expect(tx.status).toBe("completed");
        expect(tx.idempotencyKey).toBe("idem-1");
        expect(tx.reference).toBe("Venta producto X");
        expect(tx.metadata).toEqual({ migratedFrom: "legacy-system" });
        expect(tx.movementId).toBe("mov-1");
        expect(tx.createdAt).toBe(HISTORICAL_AT);
      });

      it("Then both LedgerEntries carry the historical createdAt", async () => {
        await sut.handle(ctx, cmd);

        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("wallet-1");
        expect(creditEntry.amountMinor).toBe(5000n);
        expect(creditEntry.balanceAfterMinor).toBe(15000n);
        expect(creditEntry.createdAt).toBe(HISTORICAL_AT);

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("system-wallet-1");
        expect(debitEntry.amountMinor).toBe(-5000n);
        expect(debitEntry.balanceAfterMinor).toBe(495000n);
        expect(debitEntry.createdAt).toBe(HISTORICAL_AT);
      });

    });

    // ── Optional metadata omitted ──────────────────────────────────
    describe("When importing without metadata", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "reason",
        "reference",
        "idem-nometa",
        HISTORICAL_AT,
        32,
      );

      it("Then the Transaction stores metadata as null", async () => {
        await sut.handle(ctx, cmd);

        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.metadata).toBeNull();
      });
    });

    // ── Negative historical entry ──────────────────────────────────────
    describe("When importing -3000 cents", () => {
      beforeEach(() => {});

      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        -3000n,
        "Legacy withdrawal",
        "Retiro bancario #42",
        "idem-2",
        HISTORICAL_AT,
        32,
      );

      it("Then it returns the transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance decreases", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(7000n);
      });

      it("Then the system wallet balance is adjusted with positive delta at the historical timestamp", async () => {
        await sut.handle(ctx, cmd);

        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledWith(
          expect.anything(),
          "platform-1",
          "USD",
          expect.any(Number),
                    3000n,
                    HISTORICAL_AT,
        );
      });

      it("Then the Transaction is created with type 'adjustment_debit'", async () => {
        await sut.handle(ctx, cmd);

        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.type).toBe("adjustment_debit");
        expect(tx.amountMinor).toBe(3000n);
        expect(tx.createdAt).toBe(HISTORICAL_AT);
      });

      it("Then two LedgerEntries are created (DEBIT user + CREDIT system)", async () => {
        await sut.handle(ctx, cmd);

        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("wallet-1");
        expect(debitEntry.amountMinor).toBe(-3000n);
        expect(debitEntry.balanceAfterMinor).toBe(7000n);
        expect(debitEntry.createdAt).toBe(HISTORICAL_AT);

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("system-wallet-1");
        expect(creditEntry.amountMinor).toBe(3000n);
        expect(creditEntry.balanceAfterMinor).toBe(503000n);
        expect(creditEntry.createdAt).toBe(HISTORICAL_AT);
      });

    });

    // ── Negative beyond cached balance but no active holds ────────────────────────
    describe("When importing -15000 cents (more than cached balance) with no active holds", () => {
      // holdRepo.sumActiveHolds = 0n inherited from outer beforeEach

      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        -15000n,
        "Large correction",
        "ref",
        "idem-3",
        HISTORICAL_AT,
        32,
      );

      it("Then succeeds and balance goes negative (no holds to protect)", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });
    });

    // ── Negative import that would break active holds ──────────────────────────
    // Allowing such an import would create zombie holds: captureHold calls
    // wallet.withdraw(hold.amountMinor, cachedBalance) — if cached < holdAmount the
    // capture fails with INSUFFICIENT_FUNDS and the hold can never be resolved.
    // The operator must void active holds before importing entries that break them.
    describe("When importing a negative amount that would reduce balance below active holds", () => {
      beforeEach(() => {
        // Wallet: cached=10000, holds=700 → available=9300
        // Import -9400: wouldBeAvailable = 9300 - 9400 = -100 < 0, and holds=700 > 0
        holdRepo.sumActiveHolds.mockResolvedValue(700n);
      });

      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        -9400n,
        "Correction that would break holds",
        "ref",
        "idem-hold-break",
        HISTORICAL_AT,
        32,
      );

      it("Then fails with ADJUST_WOULD_BREAK_ACTIVE_HOLDS (void holds first)", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "ADJUST_WOULD_BREAK_ACTIVE_HOLDS";
        });
      });
    });

    // ── Negative import within available balance despite active holds ──────────
    describe("When importing a negative amount within available balance (holds exist but not broken)", () => {
      beforeEach(() => {
        // Wallet: cached=10000, holds=700 → available=9300
        // Import -5000: wouldBeAvailable = 9300 - 5000 = 4300 >= 0 → allowed
        holdRepo.sumActiveHolds.mockResolvedValue(700n);
      });

      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        -5000n,
        "Correction within available",
        "ref",
        "idem-within-available",
        HISTORICAL_AT,
        32,
      );

      it("Then succeeds (adjustment stays within available balance)", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });
    });
  });

  // ── Frozen wallet ───────────────────────────────────────────────────
  describe("Given a frozen wallet", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(10000n)
          .asFrozen()
          .build(),
      );
      walletRepo.adjustSystemShardBalance.mockResolvedValue({ walletId: "system-wallet-1", cachedBalanceMinor: 0n });
      walletRepo.save.mockResolvedValue(undefined);
      
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
    });

    describe("When importing +1000 cents", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "Historical entry on frozen wallet",
        "ref",
        "idem-frozen",
        HISTORICAL_AT,
        32,
      );

      it("Then it succeeds (imports allowed on frozen wallets, same as adjust)", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });
    });
  });

  // ── Wallet not found ────────────────────────────────────────────────
  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When importing", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "nonexistent",
        "platform-1",
        1000n,
        "reason",
        "ref",
        "idem-4",
        HISTORICAL_AT,
        32,
      );

      it("Then it throws WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  // ── System wallet not found ─────────────────────────────────────────
  describe("Given the system wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .build(),
      );
      walletRepo.adjustSystemShardBalance.mockRejectedValue(
        AppError.internal(
          "SYSTEM_WALLET_NOT_FOUND",
          "system wallet not found for platform platform-1, currency USD",
        ),
      );
    });

    describe("When importing", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "reason",
        "ref",
        "idem-5",
        HISTORICAL_AT,
        32,
      );

      it("Then it throws SYSTEM_WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.Internal && err.code === "SYSTEM_WALLET_NOT_FOUND";
        });
      });
    });
  });

  // ── Platform mismatch ──────────────────────────────────────────────
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

    describe("When importing with platformId 'platform-1'", () => {
      const cmd = new ImportHistoricalEntryCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "reason",
        "ref",
        "idem-6",
        HISTORICAL_AT,
        32,
      );

      it("Then it throws WALLET_NOT_FOUND (platform mismatch — no leak)", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
