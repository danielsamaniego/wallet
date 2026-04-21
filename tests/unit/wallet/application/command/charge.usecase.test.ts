import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ChargeUseCase } from "@/wallet/application/command/charge/usecase.js";
import { ChargeCommand } from "@/wallet/application/command/charge/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

describe("ChargeUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();

  const sut = new ChargeUseCase(
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

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen.reset();
  });

  describe("Given an active user wallet with 10000 cents balance and no holds", () => {
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
      walletRepo.adjustSystemShardBalance.mockResolvedValue({ walletId: systemWallet.id, cachedBalanceMinor: 503000n });
      walletRepo.save.mockResolvedValue(undefined);
      
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
    });

    describe("When charging 3000 cents", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 3000n, "idem-1", 32, "COMMISSION");

      it("Then it returns the transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance is decreased", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(7000n);
      });

      it("Then the system wallet balance is adjusted with positive delta", async () => {
        await sut.handle(ctx, cmd);

        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledWith(
          expect.anything(),
          "platform-1",
          "USD",
          expect.any(Number),
                    3000n,
                    expect.any(Number),
        );
      });

      it("Then a Movement is created with type 'charge'", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("charge");
      });

      it("Then a Transaction is created with type 'charge' and status 'completed'", async () => {
        await sut.handle(ctx, cmd);

        expect(transactionRepo.save).toHaveBeenCalledOnce();
        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.walletId).toBe("wallet-1");
        expect(tx.counterpartWalletId).toBe("system-wallet-1");
        expect(tx.type).toBe("charge");
        expect(tx.amountMinor).toBe(3000n);
        expect(tx.status).toBe("completed");
        expect(tx.idempotencyKey).toBe("idem-1");
        expect(tx.reference).toBe("COMMISSION");
        expect(tx.movementId).toBe("mov-1");
      });

      it("Then two LedgerEntries are created (DEBIT user + CREDIT system)", async () => {
        await sut.handle(ctx, cmd);

        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("wallet-1");
        expect(debitEntry.amountMinor).toBe(-3000n);
        expect(debitEntry.balanceAfterMinor).toBe(7000n);
        expect(debitEntry.transactionId).toBe("tx-1");
        expect(debitEntry.movementId).toBe("mov-1");

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("system-wallet-1");
        expect(creditEntry.amountMinor).toBe(3000n);
        expect(creditEntry.balanceAfterMinor).toBe(503000n);
        expect(creditEntry.transactionId).toBe("tx-1");
        expect(creditEntry.movementId).toBe("mov-1");
      });
    });

    describe("When charging the exact available balance (boundary)", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 10000n, "idem-boundary", 32);

      it("Then it succeeds and returns transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance becomes zero", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(0n);
      });
    });
  });

  describe("Given a wallet with insufficient funds (balance minus holds < amount)", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(5000n)
          .build(),
      );
      walletRepo.adjustSystemShardBalance.mockResolvedValue({ walletId: "system-wallet-1", cachedBalanceMinor: 0n });
      holdRepo.sumActiveHolds.mockResolvedValue(3000n);
    });

    describe("When charging more than available balance", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 3000n, "idem-insuf", 32);

      it("Then it throws INSUFFICIENT_FUNDS", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "INSUFFICIENT_FUNDS";
        });
      });
    });
  });

  describe("Given a system wallet (isSystem = true) with zero balance", () => {
    beforeEach(() => {
      const systemWalletAsUser = new WalletBuilder()
        .withId("system-wallet-1")
        .withPlatformId("platform-1")
        .withCurrency("USD")
        .withBalance(0n)
        .asSystem()
        .build();

      const counterpartSystem = new WalletBuilder()
        .withId("system-wallet-2")
        .withPlatformId("platform-1")
        .withCurrency("USD")
        .withBalance(0n)
        .asSystem()
        .build();

      walletRepo.findById.mockResolvedValue(systemWalletAsUser);
      walletRepo.adjustSystemShardBalance.mockResolvedValue({ walletId: counterpartSystem.id, cachedBalanceMinor: counterpartSystem.cachedBalanceMinor });
      walletRepo.save.mockResolvedValue(undefined);
      
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
    });

    describe("When charging 5000 cents (exceeding balance)", () => {
      const cmd = new ChargeCommand("system-wallet-1", "platform-1", 5000n, "idem-sys", 32);

      it("Then it succeeds because system wallets bypass the funds check", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the system wallet balance goes negative", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(-5000n);
      });
    });
  });

  describe("Given a frozen wallet", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .asFrozen()
          .build(),
      );
      walletRepo.adjustSystemShardBalance.mockResolvedValue({ walletId: "system-wallet-1", cachedBalanceMinor: 0n });
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
    });

    describe("When charging", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 1000n, "idem-frozen", 32);

      it("Then it throws WALLET_NOT_ACTIVE", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_NOT_ACTIVE";
        });
      });
    });
  });

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

    describe("When charging with platformId 'platform-1'", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 1000n, "idem-plat", 32);

      it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When charging", () => {
      const cmd = new ChargeCommand("nonexistent", "platform-1", 1000n, "idem-nf", 32);

      it("Then it throws WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given the system wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(10000n)
          .build(),
      );
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
      walletRepo.adjustSystemShardBalance.mockRejectedValue(
        AppError.internal(
          "SYSTEM_WALLET_NOT_FOUND",
          "system wallet not found for platform platform-1, currency USD",
        ),
      );
    });

    describe("When charging", () => {
      const cmd = new ChargeCommand("wallet-1", "platform-1", 1000n, "idem-sys-nf", 32);

      it("Then it throws SYSTEM_WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.Internal && err.code === "SYSTEM_WALLET_NOT_FOUND";
        });
      });
    });
  });
});
