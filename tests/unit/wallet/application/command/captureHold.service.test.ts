import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockIDGenerator, createMockLogger } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { HoldBuilder } from "@test/helpers/builders/hold.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CaptureHoldService } from "@/wallet/application/command/captureHold/service.js";
import { CaptureHoldCommand } from "@/wallet/application/command/captureHold/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const PLATFORM_ID = "platform-1";
const WALLET_ID = "wallet-1";
const HOLD_ID = "hold-1";
const TX_ID = "tx-1";
const DEBIT_ENTRY_ID = "le-1";
const CREDIT_ENTRY_ID = "le-2";
const IDEMPOTENCY_KEY = "idem-key-1";

describe("CaptureHoldService", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const idGen = createMockIDGenerator([TX_ID, DEBIT_ENTRY_ID, CREDIT_ENTRY_ID]);
  const logger = createMockLogger();
  const ctx = createTestContext();

  const sut = new CaptureHoldService(
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    idGen,
    logger,
  );

  function newMovement(): Movement {
    return Movement.create({ id: "mov-1", type: "hold_capture", createdAt: 1700000000000 });
  }

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    idGen.reset();
  });

  describe("Given an active hold on an active wallet", () => {
    describe("When capturing the hold", () => {
      it("Then returns the transactionId and the movement's id, debits wallet, and persists all entities", async () => {
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
        walletRepo.adjustSystemShardBalance.mockResolvedValue({
          walletId: systemWallet.id,
          cachedBalanceMinor: systemWallet.cachedBalanceMinor,
        });
        holdRepo.transitionStatus.mockResolvedValue(undefined);
        walletRepo.save.mockResolvedValue(undefined);
        transactionRepo.save.mockResolvedValue(undefined);
        ledgerEntryRepo.saveMany.mockResolvedValue(undefined);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);
        const result = await sut.execute(ctx, cmd, newMovement());

        expect(result).toEqual({ transactionId: TX_ID, movementId: "mov-1" });

        expect(hold.status).toBe("captured");
        expect(wallet.cachedBalanceMinor).toBe(3000n);

        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.adjustSystemShardBalance).toHaveBeenCalledOnce();
        expect(transactionRepo.save).toHaveBeenCalledOnce();
        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();

        const savedEntries = ledgerEntryRepo.saveMany.mock.calls[0]![1];
        expect(savedEntries).toHaveLength(2);
      });
    });
  });

  describe("Given a hold that does not exist (race after pre-lock guard)", () => {
    describe("When capturing the hold", () => {
      it("Then throws HOLD_NOT_FOUND", async () => {
        holdRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND"
          );
        });
      });
    });
  });

  describe("Given wallet deleted after pre-lock guard (race)", () => {
    describe("When capturing the hold", () => {
      it("Then throws WALLET_NOT_FOUND from the inner re-read", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();
        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND"
          );
        });
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
          .withExpiresAt(1)
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.transitionStatus.mockResolvedValue(undefined);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_EXPIRED"
          );
        });

        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
        expect(hold.status).toBe("expired");
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

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_NOT_ACTIVE"
          );
        });

        expect(transactionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that is voided", () => {
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

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_NOT_ACTIVE"
          );
        });
      });
    });
  });

  describe("Given the system wallet does not exist", () => {
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
        walletRepo.adjustSystemShardBalance.mockRejectedValue(
          AppError.internal(
            "SYSTEM_WALLET_NOT_FOUND",
            `system wallet not found for platform ${PLATFORM_ID}, currency USD`,
          ),
        );

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.execute(ctx, cmd, newMovement())).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) &&
            err.kind === ErrorKind.Internal &&
            err.code === "SYSTEM_WALLET_NOT_FOUND"
          );
        });
      });
    });
  });
});
