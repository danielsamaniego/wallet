import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockIDGenerator, createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { HoldBuilder } from "@test/helpers/builders/hold.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CaptureHoldUseCase } from "@/wallet/application/command/captureHold/usecase.js";
import { CaptureHoldCommand } from "@/wallet/application/command/captureHold/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const PLATFORM_ID = "platform-1";
const WALLET_ID = "wallet-1";
const HOLD_ID = "hold-1";
const TX_ID = "tx-1";
const MOVEMENT_ID = "mov-1";
const DEBIT_ENTRY_ID = "le-1";
const CREDIT_ENTRY_ID = "le-2";
const IDEMPOTENCY_KEY = "idem-key-1";

describe("CaptureHoldUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator([TX_ID, MOVEMENT_ID, DEBIT_ENTRY_ID, CREDIT_ENTRY_ID]);
  const logger = createMockLogger();
  const txManager = createMockTransactionManager();
  const ctx = createTestContext();

  const useCase = new CaptureHoldUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen.reset();
  });

  describe("Given an active hold on an active wallet", () => {
    describe("When capturing the hold", () => {
      it("Then returns transactionId and movementId, debits wallet, and persists all entities", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(2000n)
          .withReference("order-123")
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        const systemWallet = new WalletBuilder()
          .withId("sys-wallet-1")
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .withBalance(0n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.findSystemWallet.mockResolvedValue(systemWallet);
        holdRepo.transitionStatus.mockResolvedValue(undefined);
        walletRepo.save.mockResolvedValue(undefined);
        walletRepo.adjustSystemWalletBalance.mockResolvedValue(undefined);
        transactionRepo.save.mockResolvedValue(undefined);
        ledgerEntryRepo.saveMany.mockResolvedValue(undefined);
        movementRepo.save.mockResolvedValue(undefined);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);
        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: TX_ID, movementId: MOVEMENT_ID });

        // Hold should have been captured (domain mutation)
        expect(hold.status).toBe("captured");

        // Wallet balance should have been debited
        expect(wallet.cachedBalanceCents).toBe(3000n); // 5000 - 2000

        // All repos should have been called
        expect(movementRepo.save).toHaveBeenCalledOnce();
        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.adjustSystemWalletBalance).toHaveBeenCalledOnce();
        expect(transactionRepo.save).toHaveBeenCalledOnce();
        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();

        // Ledger entries: should have debit + credit
        const savedEntries = ledgerEntryRepo.saveMany.mock.calls[0]![1];
        expect(savedEntries).toHaveLength(2);
      });
    });
  });

  describe("Given a hold that does not exist", () => {
    describe("When capturing the hold", () => {
      it("Then throws HOLD_NOT_FOUND", async () => {
        holdRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        expect(walletRepo.findById).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given an active hold that has expired (lazy check)", () => {
    describe("When capturing the hold", () => {
      it("Then saves hold as expired and throws HOLD_EXPIRED", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .withExpiresAt(1) // expired long ago
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        const systemWallet = new WalletBuilder()
          .withId("sys-wallet-1")
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .withBalance(0n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.findSystemWallet.mockResolvedValue(systemWallet);
        holdRepo.transitionStatus.mockResolvedValue(undefined);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_EXPIRED";
        });

        // Hold should be transitioned to expired
        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
        expect(hold.status).toBe("expired");

        // Transaction should NOT have been created
        expect(transactionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that is not active (already captured)", () => {
    describe("When capturing the hold", () => {
      it("Then throws HOLD_NOT_ACTIVE", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .asCaptured()
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        const systemWallet = new WalletBuilder()
          .withId("sys-wallet-1")
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .withBalance(0n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.findSystemWallet.mockResolvedValue(systemWallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        // hold.capture(now) will throw HOLD_NOT_ACTIVE because status is "captured"
        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_NOT_ACTIVE";
        });

        expect(transactionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that is not active (voided)", () => {
    describe("When capturing the hold", () => {
      it("Then throws HOLD_NOT_ACTIVE", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .asVoided()
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        const systemWallet = new WalletBuilder()
          .withId("sys-wallet-1")
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .withBalance(0n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.findSystemWallet.mockResolvedValue(systemWallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_NOT_ACTIVE";
        });
      });
    });
  });

  describe("Given a hold whose wallet does not exist", () => {
    describe("When capturing the hold", () => {
      it("Then throws WALLET_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId("missing-wallet")
          .withAmount(1000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });

        expect(walletRepo.findSystemWallet).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold whose wallet has no system wallet", () => {
    describe("When capturing the hold", () => {
      it("Then throws SYSTEM_WALLET_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.findSystemWallet.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.Internal && err.code === "SYSTEM_WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a platform mismatch between command and wallet", () => {
    describe("When capturing the hold", () => {
      it("Then throws WALLET_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });

        expect(walletRepo.findSystemWallet).not.toHaveBeenCalled();
      });
    });
  });
});
