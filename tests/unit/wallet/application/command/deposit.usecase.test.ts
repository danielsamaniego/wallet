import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { DepositUseCase } from "@/wallet/application/command/deposit/usecase.js";
import { DepositCommand } from "@/wallet/application/command/deposit/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

describe("DepositUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const idGen = createMockIDGenerator(["tx-1", "mov-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();

  const sut = new DepositUseCase(
    txManager,
    walletRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );

  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen.reset();
  });

  describe("Given an active user wallet and a system wallet exist", () => {
    const userWallet = new WalletBuilder()
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

    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(
        new WalletBuilder()
          .withId("wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .withBalance(10000n)
          .build(),
      );
      walletRepo.findSystemWallet.mockResolvedValue(systemWallet);
      walletRepo.save.mockResolvedValue(undefined);
      walletRepo.adjustSystemWalletBalance.mockResolvedValue(undefined);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
      movementRepo.save.mockResolvedValue(undefined);
    });

    describe("When depositing 5000 cents", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 5000n, "idem-1", "ref-1");

      it("Then it returns the transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance is updated (original + deposit)", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceCents).toBe(15000n);
      });

      it("Then the system wallet balance is adjusted with negative delta", async () => {
        await sut.handle(ctx, cmd);

        expect(walletRepo.adjustSystemWalletBalance).toHaveBeenCalledWith(
          expect.anything(),
          "system-wallet-1",
          -5000n,
          expect.any(Number),
        );
      });

      it("Then a Movement is created with type 'deposit'", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("deposit");
      });

      it("Then a Transaction is created with type 'deposit' and status 'completed'", async () => {
        await sut.handle(ctx, cmd);

        expect(transactionRepo.save).toHaveBeenCalledOnce();
        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.walletId).toBe("wallet-1");
        expect(tx.counterpartWalletId).toBe("system-wallet-1");
        expect(tx.type).toBe("deposit");
        expect(tx.amountCents).toBe(5000n);
        expect(tx.status).toBe("completed");
        expect(tx.idempotencyKey).toBe("idem-1");
        expect(tx.reference).toBe("ref-1");
        expect(tx.movementId).toBe("mov-1");
      });

      it("Then two LedgerEntries are created (CREDIT user + DEBIT system)", async () => {
        await sut.handle(ctx, cmd);

        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
        const entries = ledgerEntryRepo.saveMany.mock.calls[0]![1] as LedgerEntry[];
        expect(entries).toHaveLength(2);

        const creditEntry = entries.find((e) => e.entryType === "CREDIT")!;
        expect(creditEntry.walletId).toBe("wallet-1");
        expect(creditEntry.amountCents).toBe(5000n);
        expect(creditEntry.balanceAfterCents).toBe(15000n);
        expect(creditEntry.transactionId).toBe("tx-1");
        expect(creditEntry.movementId).toBe("mov-1");

        const debitEntry = entries.find((e) => e.entryType === "DEBIT")!;
        expect(debitEntry.walletId).toBe("system-wallet-1");
        expect(debitEntry.amountCents).toBe(-5000n);
        expect(debitEntry.balanceAfterCents).toBe(495000n);
        expect(debitEntry.transactionId).toBe("tx-1");
        expect(debitEntry.movementId).toBe("mov-1");
      });
    });

    describe("When depositing 1 cent (minimum amount)", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1n, "idem-min");

      it("Then it succeeds and returns transactionId and movementId", async () => {
        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance increases by 1", async () => {
        await sut.handle(ctx, cmd);

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceCents).toBe(10001n);
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("nonexistent", "platform-1", 1000n, "idem-2");

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
          .build(),
      );
      walletRepo.findSystemWallet.mockResolvedValue(null);
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-3");

      it("Then it throws SYSTEM_WALLET_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.Internal && err.code === "SYSTEM_WALLET_NOT_FOUND";
        });
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
      walletRepo.findSystemWallet.mockResolvedValue(
        new WalletBuilder()
          .withId("system-wallet-1")
          .withPlatformId("platform-1")
          .withCurrency("USD")
          .asSystem()
          .build(),
      );
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-4");

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

    describe("When depositing with platformId 'platform-1'", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-5");

      it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
