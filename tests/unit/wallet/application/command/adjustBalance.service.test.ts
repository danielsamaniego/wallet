import { mock, mockReset } from "vitest-mock-extended";
import { createMockIDGenerator, createMockLogger } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { AdjustBalanceService } from "@/wallet/application/command/adjustBalance/service.js";
import { AdjustBalanceCommand } from "@/wallet/application/command/adjustBalance/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

describe("AdjustBalanceService", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const idGen = createMockIDGenerator(["tx-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();

  const sut = new AdjustBalanceService(
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    idGen,
    logger,
  );
  const ctx = createTestContext();

  function newMovement(reason: string | null = "Promotional credit"): Movement {
    return Movement.create({
      id: "mov-1",
      type: "adjustment",
      platformId: "platform-1",
      reason,
      createdAt: 1700000000000,
    });
  }

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    idGen.reset();
  });

  // ── Positive adjustment ─────────────────────────────────────────────
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
      walletRepo.adjustSystemShardBalance.mockImplementation(
        async (_ctx, _p, _c, _s, delta, _n) => ({
          walletId: systemWallet.id,
          cachedBalanceMinor: systemWallet.cachedBalanceMinor + delta,
        }),
      );
      walletRepo.save.mockResolvedValue(undefined);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
    });

    describe("When adjusting +5000 cents (positive)", () => {
      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        5000n,
        "Promotional credit",
        "idem-1",
        false,
        32,
        "ref-1",
      );

      it("Then it returns the transactionId and the movement's id", async () => {
        const result = await sut.execute(ctx, cmd, newMovement());

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance is updated (original + adjustment)", async () => {
        await sut.execute(ctx, cmd, newMovement());

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(15000n);
      });

      it("Then the system wallet balance is adjusted with negative delta", async () => {
        await sut.execute(ctx, cmd, newMovement());

        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledWith(
          expect.anything(),
          "platform-1",
          "USD",
          expect.any(Number),
          -5000n,
          expect.any(Number),
        );
      });

      it("Then a Transaction is created with type 'adjustment_credit'", async () => {
        await sut.execute(ctx, cmd, newMovement());

        expect(transactionRepo.save).toHaveBeenCalledOnce();
        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.walletId).toBe("wallet-1");
        expect(tx.counterpartWalletId).toBe("system-wallet-1");
        expect(tx.type).toBe("adjustment_credit");
        expect(tx.amountMinor).toBe(5000n);
        expect(tx.status).toBe("completed");
        expect(tx.idempotencyKey).toBe("idem-1");
        expect(tx.reference).toBe("ref-1");
        expect(tx.movementId).toBe("mov-1");
      });

      it("Then two LedgerEntries are created (CREDIT user + DEBIT system)", async () => {
        await sut.execute(ctx, cmd, newMovement());

        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("wallet-1");
        expect(creditEntry.amountMinor).toBe(5000n);
        expect(creditEntry.balanceAfterMinor).toBe(15000n);
        expect(creditEntry.transactionId).toBe("tx-1");
        expect(creditEntry.movementId).toBe("mov-1");

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("system-wallet-1");
        expect(debitEntry.amountMinor).toBe(-5000n);
        expect(debitEntry.balanceAfterMinor).toBe(495000n);
        expect(debitEntry.transactionId).toBe("tx-1");
        expect(debitEntry.movementId).toBe("mov-1");
      });

      it("Then holdRepo.sumActiveHolds is NOT called (positive adjustment)", async () => {
        await sut.execute(ctx, cmd, newMovement());

        expect(holdRepo.sumActiveHolds).not.toHaveBeenCalled();
      });
    });

    // ── Negative adjustment ───────────────────────────────────────────
    describe("When adjusting -3000 cents (negative) with no active holds", () => {
      beforeEach(() => {
        holdRepo.sumActiveHolds.mockResolvedValue(0n);
      });

      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        -3000n,
        "Error correction",
        "idem-2",
        false,
        32,
      );

      it("Then it returns the transactionId and the movement's id", async () => {
        const result = await sut.execute(ctx, cmd, newMovement("Error correction"));

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance decreases", async () => {
        await sut.execute(ctx, cmd, newMovement("Error correction"));

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(7000n);
      });

      it("Then the system wallet balance is adjusted with positive delta", async () => {
        await sut.execute(ctx, cmd, newMovement("Error correction"));

        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledWith(
          expect.anything(),
          "platform-1",
          "USD",
          expect.any(Number),
          3000n,
          expect.any(Number),
        );
      });

      it("Then a Transaction is created with type 'adjustment_debit'", async () => {
        await sut.execute(ctx, cmd, newMovement("Error correction"));

        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.type).toBe("adjustment_debit");
        expect(tx.amountMinor).toBe(3000n);
      });

      it("Then two LedgerEntries are created (DEBIT user + CREDIT system)", async () => {
        await sut.execute(ctx, cmd, newMovement("Error correction"));

        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("wallet-1");
        expect(debitEntry.amountMinor).toBe(-3000n);
        expect(debitEntry.balanceAfterMinor).toBe(7000n);

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("system-wallet-1");
        expect(creditEntry.amountMinor).toBe(3000n);
        expect(creditEntry.balanceAfterMinor).toBe(503000n);
      });

      it("Then holdRepo.sumActiveHolds IS called (negative adjustment)", async () => {
        await sut.execute(ctx, cmd, newMovement("Error correction"));

        expect(holdRepo.sumActiveHolds).toHaveBeenCalledWith(expect.anything(), "wallet-1");
      });
    });

    // ── Negative adjustment with insufficient funds ────────────────────
    describe("When adjusting -15000 cents (more than available with holds)", () => {
      beforeEach(() => {
        holdRepo.sumActiveHolds.mockResolvedValue(2000n);
      });

      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        -15000n,
        "Large correction",
        "idem-3",
        false,
        32,
      );

      it("Then throws INSUFFICIENT_FUNDS", async () => {
        await expect(sut.execute(ctx, cmd, newMovement("Large correction"))).rejects.toSatisfy(
          (err: AppError) => {
            return err.kind === ErrorKind.DomainRule && err.code === "INSUFFICIENT_FUNDS";
          },
        );
      });
    });

    // ── Negative adjustment with allowNegativeBalance=true, no holds ───
    describe("When adjusting -15000 cents with allowNegativeBalance=true and no active holds", () => {
      beforeEach(() => {
        holdRepo.sumActiveHolds.mockResolvedValue(0n);
      });

      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        -15000n,
        "Dispute chargeback",
        "idem-neg",
        true,
        32,
      );

      it("Then it succeeds and results in a negative balance", async () => {
        const result = await sut.execute(ctx, cmd, newMovement("Dispute chargeback"));

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(-5000n);
      });
    });

    // ── Negative adjustment with allowNegativeBalance=true, active holds ─
    describe("When adjusting -15000 cents with allowNegativeBalance=true but active holds exist", () => {
      beforeEach(() => {
        holdRepo.sumActiveHolds.mockResolvedValue(2000n);
      });

      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        -15000n,
        "Dispute chargeback",
        "idem-holds",
        true,
        32,
      );

      it("Then it fails with ADJUST_WOULD_BREAK_ACTIVE_HOLDS", async () => {
        await expect(sut.execute(ctx, cmd, newMovement("Dispute chargeback"))).rejects.toSatisfy(
          (err: AppError) => {
            return (
              err.kind === ErrorKind.DomainRule && err.code === "ADJUST_WOULD_BREAK_ACTIVE_HOLDS"
            );
          },
        );
      });
    });

    // ── Negative adjustment within available despite holds ───────────
    describe("When adjusting -1000 cents with allowNegativeBalance=true and holds within available", () => {
      beforeEach(() => {
        holdRepo.sumActiveHolds.mockResolvedValue(2000n);
      });

      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        -1000n,
        "Fee within available",
        "idem-within",
        true,
        32,
      );

      it("Then it succeeds and balance decreases correctly", async () => {
        const result = await sut.execute(ctx, cmd, newMovement("Fee within available"));

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(9000n);
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
      walletRepo.adjustSystemShardBalance.mockResolvedValue({
        walletId: "system-wallet-1",
        cachedBalanceMinor: 0n,
      });
      walletRepo.save.mockResolvedValue(undefined);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
    });

    describe("When adjusting +1000 cents", () => {
      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "Admin correction on frozen wallet",
        "idem-frozen",
        false,
        32,
      );

      it("Then it succeeds (adjustments allowed on frozen wallets)", async () => {
        const result = await sut.execute(
          ctx,
          cmd,
          newMovement("Admin correction on frozen wallet"),
        );

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });
    });
  });

  // ── Wallet not found ────────────────────────────────────────────────
  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When adjusting", () => {
      const cmd = new AdjustBalanceCommand(
        "nonexistent",
        "platform-1",
        1000n,
        "reason",
        "idem-4",
        false,
        32,
      );

      it("Then it throws WALLET_NOT_FOUND", async () => {
        await expect(sut.execute(ctx, cmd, newMovement("reason"))).rejects.toSatisfy(
          (err: AppError) => {
            return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
          },
        );
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

    describe("When adjusting", () => {
      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "reason",
        "idem-5",
        false,
        32,
      );

      it("Then it throws SYSTEM_WALLET_NOT_FOUND", async () => {
        await expect(sut.execute(ctx, cmd, newMovement("reason"))).rejects.toSatisfy(
          (err: AppError) => {
            return err.kind === ErrorKind.Internal && err.code === "SYSTEM_WALLET_NOT_FOUND";
          },
        );
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

    describe("When adjusting with platformId 'platform-1'", () => {
      const cmd = new AdjustBalanceCommand(
        "wallet-1",
        "platform-1",
        1000n,
        "reason",
        "idem-6",
        false,
        32,
      );

      it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
        await expect(sut.execute(ctx, cmd, newMovement("reason"))).rejects.toSatisfy(
          (err: AppError) => {
            return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
          },
        );
      });
    });
  });
});
