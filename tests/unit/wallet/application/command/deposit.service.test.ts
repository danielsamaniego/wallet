import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { DepositService } from "@/wallet/application/command/deposit/service.js";
import { DepositCommand } from "@/wallet/application/command/deposit/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import type { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

/**
 * Service tests cover the deposit business rules. Inputs the use case has
 * already prepared (lock acquired, tx open, Movement persisted) are
 * represented by a real Movement instance + a transactional AppContext.
 */
describe("DepositService", () => {
  const walletRepo = mock<IWalletRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const idGen = createMockIDGenerator(["tx-1", "ledger-1", "ledger-2"]);
  const logger = createMockLogger();

  const sut = new DepositService(walletRepo, transactionRepo, ledgerEntryRepo, idGen, logger);

  const ctx = createTestContext();

  function newMovement(): Movement {
    return Movement.create({ id: "mov-1", type: "deposit", createdAt: 1700000000000 });
  }

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    idGen.reset();
  });

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
      walletRepo.adjustSystemShardBalance.mockResolvedValue({
        walletId: systemWallet.id,
        cachedBalanceMinor: systemWallet.cachedBalanceMinor - 5000n,
      });
      walletRepo.save.mockResolvedValue(undefined);
      transactionRepo.save.mockResolvedValue(undefined);
      ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
    });

    describe("When depositing 5000 cents", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 5000n, "idem-1", 32, "ref-1");

      it("Then it returns the transactionId and the movement's id", async () => {
        const result = await sut.execute(ctx, cmd, newMovement());

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance is updated (original + deposit)", async () => {
        await sut.execute(ctx, cmd, newMovement());

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(15000n);
      });

      it("Then the system wallet shard is adjusted with a negative delta via adjustSystemShardBalance", async () => {
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

      it("Then a Transaction is created with type 'deposit' and status 'completed' referencing the given Movement", async () => {
        await sut.execute(ctx, cmd, newMovement());

        expect(transactionRepo.save).toHaveBeenCalledOnce();
        const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
        expect(tx.id).toBe("tx-1");
        expect(tx.walletId).toBe("wallet-1");
        expect(tx.counterpartWalletId).toBe("system-wallet-1");
        expect(tx.type).toBe("deposit");
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
    });

    describe("When depositing 1 cent (minimum amount)", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1n, "idem-min", 32);

      it("Then it succeeds and returns transactionId and the movement's id", async () => {
        const result = await sut.execute(ctx, cmd, newMovement());

        expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
      });

      it("Then the user wallet balance increases by 1", async () => {
        await sut.execute(ctx, cmd, newMovement());

        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.cachedBalanceMinor).toBe(10001n);
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValue(null);
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("nonexistent", "platform-1", 1000n, "idem-2", 32);

      it("Then it throws WALLET_NOT_FOUND", async () => {
        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: AppError) => {
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
      walletRepo.adjustSystemShardBalance.mockRejectedValue(
        AppError.internal(
          "SYSTEM_WALLET_NOT_FOUND",
          "system wallet not found for platform platform-1, currency USD",
        ),
      );
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-3", 32);

      it("Then it throws SYSTEM_WALLET_NOT_FOUND", async () => {
        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: AppError) => {
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
      walletRepo.adjustSystemShardBalance.mockResolvedValue({
        walletId: "system-wallet-1",
        cachedBalanceMinor: 0n,
      });
    });

    describe("When depositing", () => {
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-4", 32);

      it("Then it throws WALLET_NOT_ACTIVE", async () => {
        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: AppError) => {
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
      const cmd = new DepositCommand("wallet-1", "platform-1", 1000n, "idem-5", 32);

      it("Then it throws WALLET_NOT_FOUND (platform mismatch)", async () => {
        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
