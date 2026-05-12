import { describe, it, expect, beforeEach, vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { HoldBuilder } from "@test/helpers/builders/hold.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CaptureHoldUseCase } from "@/wallet/application/command/captureHold/usecase.js";
import { CaptureHoldCommand } from "@/wallet/application/command/captureHold/command.js";
import type { CaptureHoldService } from "@/wallet/application/command/captureHold/service.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

const PLATFORM_ID = "platform-1";
const WALLET_ID = "wallet-1";
const HOLD_ID = "hold-1";
const MOVEMENT_ID = "mov-1";
const IDEMPOTENCY_KEY = "idem-key-1";

describe("CaptureHoldUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator([MOVEMENT_ID]);
  const logger = createMockLogger();
  const txManager = createMockTransactionManager();
  const lockRunner = createMockLockRunner();
  const captureHoldService = mock<CaptureHoldService>();
  const ctx = createTestContext();

  const sut = new CaptureHoldUseCase(
    txManager,
    walletRepo,
    holdRepo,
    movementRepo,
    idGen,
    logger,
    lockRunner,
    captureHoldService,
  );

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(movementRepo);
    mockReset(captureHoldService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    captureHoldService.execute.mockResolvedValue({
      transactionId: "tx-1",
      movementId: MOVEMENT_ID,
    });
  });

  describe("Given a hold owned by the requesting platform", () => {
    const hold = new HoldBuilder().withId(HOLD_ID).withWalletId(WALLET_ID).withAmount(1000n).build();
    const wallet = new WalletBuilder().withId(WALLET_ID).withPlatformId(PLATFORM_ID).build();

    beforeEach(() => {
      holdRepo.findById.mockResolvedValue(hold);
      walletRepo.findById.mockResolvedValue(wallet);
    });

    describe("When handle is called", () => {
      const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

      it("Then it acquires the per-wallet lock with key derived from the hold's wallet", async () => {
        await sut.handle(ctx, cmd);

        expect(lockRunner.run).toHaveBeenCalledWith(
          expect.anything(),
          [`wallet-lock:${WALLET_ID}`],
          expect.any(Function),
        );
      });

      it("Then it opens a transaction via txManager.run", async () => {
        await sut.handle(ctx, cmd);

        expect(txManager.run).toHaveBeenCalledOnce();
      });

      it("Then it creates a Movement(type='hold_capture', status='posted') and saves it", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe(MOVEMENT_ID);
        expect(movement.type).toBe("hold_capture");
        expect(movement.status).toBe("posted");
      });

      it("Then it delegates to CaptureHoldService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(captureHoldService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] = captureHoldService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe(MOVEMENT_ID);
      });

      it("Then it returns whatever the service returned", async () => {
        captureHoldService.execute.mockResolvedValue({
          transactionId: "tx-from-service",
          movementId: MOVEMENT_ID,
        });

        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-from-service", movementId: MOVEMENT_ID });
      });
    });
  });

  describe("Given the pre-lock guard finds no hold", () => {
    describe("When handle is called", () => {
      it("Then it throws HOLD_NOT_FOUND without acquiring lock or opening tx", async () => {
        holdRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND"
          );
        });

        expect(walletRepo.findById).not.toHaveBeenCalled();
        expect(lockRunner.run).not.toHaveBeenCalled();
        expect(txManager.run).not.toHaveBeenCalled();
        expect(captureHoldService.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold belonging to another platform (cross-tenant)", () => {
    describe("When the attacker platform invokes capture", () => {
      it("Then the pre-lock guard rejects with HOLD_NOT_FOUND BEFORE acquiring the lock", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();
        const victimWallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("platform-victim")
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(victimWallet);

        const cmd = new CaptureHoldCommand(HOLD_ID, "platform-attacker", IDEMPOTENCY_KEY, 32);

        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND"
          );
        });

        expect(lockRunner.run).not.toHaveBeenCalled();
        expect(txManager.run).not.toHaveBeenCalled();
        expect(captureHoldService.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given the pre-lock guard finds the hold but its wallet is missing", () => {
    describe("When handle is called", () => {
      it("Then the pre-lock guard collapses to HOLD_NOT_FOUND (data-integrity case)", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId("missing-wallet")
          .withAmount(1000n)
          .build();
        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return (
            AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND"
          );
        });

        expect(captureHoldService.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();
        const wallet = new WalletBuilder().withId(WALLET_ID).withPlatformId(PLATFORM_ID).build();
        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        captureHoldService.execute.mockRejectedValue(new Error("HOLD_EXPIRED"));

        const cmd = new CaptureHoldCommand(HOLD_ID, PLATFORM_ID, IDEMPOTENCY_KEY, 32);

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("HOLD_EXPIRED");
      });
    });
  });
});
