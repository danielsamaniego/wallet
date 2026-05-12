import { describe, it, expect, beforeEach, vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ProcessMovementCommand } from "@/wallet/application/worker/processMovement/command.js";
import { ProcessMovementUseCase } from "@/wallet/application/worker/processMovement/usecase.js";
import type { AdjustBalanceService } from "@/wallet/application/command/adjustBalance/service.js";
import type { CaptureHoldService } from "@/wallet/application/command/captureHold/service.js";
import type { ChargeService } from "@/wallet/application/command/charge/service.js";
import type { DepositService } from "@/wallet/application/command/deposit/service.js";
import type { TransferService } from "@/wallet/application/command/transfer/service.js";
import type { WithdrawService } from "@/wallet/application/command/withdraw/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { IResultPublisher } from "@/wallet/domain/ports/result.publisher.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import type {
  MovementQueuePayload,
  MovementType,
} from "@/wallet/domain/movement/movement.entity.js";

const PLATFORM_ID = "platform-1";
const MOV_ID = "mov-1";

function makeProcessing(
  type: MovementType,
  payload: MovementQueuePayload,
  overrides: { platformId?: string | null } = {},
): Movement {
  return Movement.reconstruct({
    id: MOV_ID,
    type,
    status: "processing",
    platformId: overrides.platformId === undefined ? PLATFORM_ID : overrides.platformId,
    reason: null,
    failedReason: null,
    queuePayload: payload,
    createdAt: 1_700_000_000_000,
  });
}

describe("ProcessMovementUseCase", () => {
  const movementRepo = mock<IMovementRepository>();
  const resultPublisher = mock<IResultPublisher>();
  const depositService = mock<DepositService>();
  const withdrawService = mock<WithdrawService>();
  const transferService = mock<TransferService>();
  const chargeService = mock<ChargeService>();
  const adjustBalanceService = mock<AdjustBalanceService>();
  const captureHoldService = mock<CaptureHoldService>();
  const txManager = createMockTransactionManager();
  const lockRunner = createMockLockRunner();
  const logger = createMockLogger();
  const ctx = createTestContext();

  const sut = new ProcessMovementUseCase(
    txManager,
    lockRunner,
    movementRepo,
    resultPublisher,
    depositService,
    withdrawService,
    transferService,
    chargeService,
    adjustBalanceService,
    captureHoldService,
    logger,
  );

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(resultPublisher);
    mockReset(depositService);
    mockReset(withdrawService);
    mockReset(transferService);
    mockReset(chargeService);
    mockReset(adjustBalanceService);
    mockReset(captureHoldService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
  });

  describe("Given markProcessing returns null (already claimed or non-pending)", () => {
    describe("When handle is called", () => {
      it("Then it returns outcome=noop without dispatching any service", async () => {
        movementRepo.markProcessing.mockResolvedValue(null);

        const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(result).toEqual({ outcome: "noop" });
        expect(depositService.execute).not.toHaveBeenCalled();
        expect(withdrawService.execute).not.toHaveBeenCalled();
        expect(transferService.execute).not.toHaveBeenCalled();
        expect(chargeService.execute).not.toHaveBeenCalled();
        expect(adjustBalanceService.execute).not.toHaveBeenCalled();
        expect(captureHoldService.execute).not.toHaveBeenCalled();
      });

      it("Then it does NOT publish a result (the awaiting handler will time out and 202 the client, or another worker will publish first)", async () => {
        movementRepo.markProcessing.mockResolvedValue(null);

        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(resultPublisher.publish).not.toHaveBeenCalled();
        expect(movementRepo.markPosted).not.toHaveBeenCalled();
        expect(movementRepo.markFailed).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given markProcessing returns a deposit movement with a valid queue_payload", () => {
    const movement = makeProcessing("deposit", {
      walletId: "wallet-1",
      amountMinor: "1500",
      idempotencyKey: "idem-d",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockResolvedValue({
        transactionId: "tx-d",
        movementId: MOV_ID,
      });
    });

    describe("When handle is called", () => {
      it("Then it acquires the per-wallet lock with the key derived from queue_payload.walletId", async () => {
        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(lockRunner.run).toHaveBeenCalledWith(
          expect.anything(),
          ["wallet-lock:wallet-1"],
          expect.any(Function),
        );
      });

      it("Then it opens a transaction and dispatches DepositService.execute inside it", async () => {
        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(txManager.run).toHaveBeenCalledOnce();
        expect(depositService.execute).toHaveBeenCalledOnce();
        const [, cmd, mov] = depositService.execute.mock.calls[0]!;
        expect(cmd.walletId).toBe("wallet-1");
        expect(cmd.platformId).toBe(PLATFORM_ID);
        expect(cmd.amountMinor).toBe(1500n);
        expect(mov.id).toBe(MOV_ID);
      });

      it("Then it transitions the movement to posted inside the same transaction (atomic with service writes)", async () => {
        const callOrder: string[] = [];
        depositService.execute.mockImplementation(async () => {
          callOrder.push("service");
          return { transactionId: "tx-d", movementId: MOV_ID };
        });
        movementRepo.markPosted.mockImplementation(async () => {
          callOrder.push("markPosted");
        });

        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(callOrder).toEqual(["service", "markPosted"]);
        expect(movementRepo.markPosted).toHaveBeenCalledWith(expect.anything(), MOV_ID);
      });

      it("Then it publishes a posted result carrying the service body so the awaiting HTTP handler can return the same 200 shape as the sync path", async () => {
        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(resultPublisher.publish).toHaveBeenCalledOnce();
        expect(resultPublisher.publish).toHaveBeenCalledWith(expect.anything(), {
          movementId: MOV_ID,
          status: "posted",
          body: { transactionId: "tx-d", movementId: MOV_ID },
        });
      });

      it("Then it returns outcome=posted", async () => {
        const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
        expect(result).toEqual({ outcome: "posted" });
      });

      it("Then publish runs OUTSIDE the lock/tx (releasing the lock before the optional Redis blip)", async () => {
        const order: string[] = [];
        (lockRunner.run as ReturnType<typeof vi.fn>).mockImplementationOnce(
          async (_c: unknown, _k: unknown, fn: () => Promise<unknown>) => {
            const r = await fn();
            order.push("lock-released");
            return r;
          },
        );
        resultPublisher.publish.mockImplementation(async () => {
          order.push("publish");
        });

        await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));

        expect(order).toEqual(["lock-released", "publish"]);
      });
    });
  });

  describe("Given markProcessing returns a withdrawal movement", () => {
    const movement = makeProcessing("withdrawal", {
      walletId: "wallet-w",
      amountMinor: "200",
      idempotencyKey: "idem-w",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      withdrawService.execute.mockResolvedValue({ transactionId: "tx-w", movementId: MOV_ID });
    });

    it("Then WithdrawService.execute is invoked and the movement is posted", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(withdrawService.execute).toHaveBeenCalledOnce();
      expect(depositService.execute).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: "posted" });
    });
  });

  describe("Given markProcessing returns a charge movement", () => {
    const movement = makeProcessing("charge", {
      walletId: "w-c",
      amountMinor: "9999",
      idempotencyKey: "idem-c",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      chargeService.execute.mockResolvedValue({ transactionId: "tx-c", movementId: MOV_ID });
    });

    it("Then ChargeService.execute is invoked and the movement is posted", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(chargeService.execute).toHaveBeenCalledOnce();
      expect(result).toEqual({ outcome: "posted" });
    });
  });

  describe("Given markProcessing returns an adjustment movement", () => {
    const movement = makeProcessing("adjustment", {
      walletId: "w-a",
      amountMinor: "-500",
      reason: "manual fee",
      idempotencyKey: "idem-a",
      allowNegativeBalance: true,
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      adjustBalanceService.execute.mockResolvedValue({
        transactionId: "tx-a",
        movementId: MOV_ID,
      });
    });

    it("Then AdjustBalanceService.execute is invoked carrying reason and allowNegativeBalance", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      const [, cmd] = adjustBalanceService.execute.mock.calls[0]!;
      expect(cmd.reason).toBe("manual fee");
      expect(cmd.allowNegativeBalance).toBe(true);
      expect(cmd.amountMinor).toBe(-500n);
    });
  });

  describe("Given markProcessing returns a transfer movement", () => {
    const movement = makeProcessing("transfer", {
      sourceWalletId: "src",
      targetWalletId: "tgt",
      amountMinor: "500",
      idempotencyKey: "idem-t",
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      transferService.execute.mockResolvedValue({
        sourceTransactionId: "tx-s",
        targetTransactionId: "tx-t",
        movementId: MOV_ID,
      });
    });

    it("Then both source and target wallet lock keys are passed to the runner so A↔B contention is serialized", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(lockRunner.run).toHaveBeenCalledWith(
        expect.anything(),
        ["wallet-lock:src", "wallet-lock:tgt"],
        expect.any(Function),
      );
    });

    it("Then TransferService.execute is invoked", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(transferService.execute).toHaveBeenCalledOnce();
    });
  });

  describe("Given markProcessing returns a hold_capture movement", () => {
    const movement = makeProcessing("hold_capture", {
      holdId: "hold-1",
      walletId: "w-of-hold",
      idempotencyKey: "idem-ch",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      captureHoldService.execute.mockResolvedValue({
        transactionId: "tx-ch",
        movementId: MOV_ID,
      });
    });

    it("Then the lock key is derived from queue_payload.walletId (pre-resolved by the HTTP handler)", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(lockRunner.run).toHaveBeenCalledWith(
        expect.anything(),
        ["wallet-lock:w-of-hold"],
        expect.any(Function),
      );
    });

    it("Then CaptureHoldService.execute is invoked", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(captureHoldService.execute).toHaveBeenCalledOnce();
      const [, cmd] = captureHoldService.execute.mock.calls[0]!;
      expect(cmd.holdId).toBe("hold-1");
    });
  });

  describe("Given the queue_payload is malformed (hydration fails before any DB write)", () => {
    const movement = makeProcessing("deposit", {
      walletId: 123, // wrong type — hydrator rejects
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
    });

    it("Then no service is called and the movement is markFailed with the hydrator's reason", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(depositService.execute).not.toHaveBeenCalled();
      expect(movementRepo.markFailed).toHaveBeenCalledOnce();
      const [, id, reason] = movementRepo.markFailed.mock.calls[0]!;
      expect(id).toBe(MOV_ID);
      expect(reason).toMatch(/walletId/);
      expect(result.outcome).toBe("failed");
    });

    it("Then it publishes a failed result so the awaiting handler can return 200 with status=failed instead of timing out", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(resultPublisher.publish).toHaveBeenCalledOnce();
      const [, msg] = resultPublisher.publish.mock.calls[0]!;
      expect(msg.status).toBe("failed");
      expect(msg.failedReason).toMatch(/walletId/);
    });
  });

  describe("Given the claimed movement has platform_id = null (legacy orphan that should never have been enqueued)", () => {
    const movement = makeProcessing(
      "deposit",
      {
        walletId: "w1",
        amountMinor: "100",
        idempotencyKey: "k",
        systemWalletShardCount: 32,
      },
      { platformId: null },
    );

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
    });

    it("Then hydration rejects the null platform_id and the movement is markFailed", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(depositService.execute).not.toHaveBeenCalled();
      expect(movementRepo.markFailed).toHaveBeenCalledOnce();
      expect(result.failedReason).toMatch(/platform_id is null/);
    });
  });

  describe("Given the service throws a domain error (e.g. insufficient funds)", () => {
    const movement = makeProcessing("withdrawal", {
      walletId: "w1",
      amountMinor: "10000",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      withdrawService.execute.mockRejectedValue(new Error("insufficient funds"));
    });

    it("Then the movement is markFailed with the error message as the reason", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(movementRepo.markFailed).toHaveBeenCalledWith(
        expect.anything(),
        MOV_ID,
        "insufficient funds",
      );
    });

    it("Then it publishes a failed result", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(resultPublisher.publish).toHaveBeenCalledWith(expect.anything(), {
        movementId: MOV_ID,
        status: "failed",
        failedReason: "insufficient funds",
      });
    });

    it("Then markPosted is NOT called", async () => {
      await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(movementRepo.markPosted).not.toHaveBeenCalled();
    });
  });

  describe("Given the service throws a non-Error value (defensive coverage)", () => {
    const movement = makeProcessing("deposit", {
      walletId: "w1",
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockRejectedValue("string-error");
    });

    it("Then the failure reason is the stringified value (the use case never crashes on non-Error throws)", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(result.failedReason).toBe("string-error");
    });
  });

  describe("Given markFailed itself throws (DB blip on the failure path)", () => {
    const movement = makeProcessing("deposit", {
      walletId: "w1",
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockRejectedValue(new Error("primary failure"));
      movementRepo.markFailed.mockRejectedValue(new Error("DB unreachable"));
    });

    it("Then the use case still tries to publish a failed result so a waiting handler can stop polling", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(resultPublisher.publish).toHaveBeenCalledWith(expect.anything(), {
        movementId: MOV_ID,
        status: "failed",
        failedReason: "primary failure",
      });
      expect(result.outcome).toBe("failed");
    });
  });

  describe("Given markFailed throws a non-Error value", () => {
    const movement = makeProcessing("deposit", {
      walletId: "w1",
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockRejectedValue(new Error("primary failure"));
      movementRepo.markFailed.mockRejectedValue("string-mark-error");
    });

    it("Then the use case still tries to publish the failed result", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(resultPublisher.publish).toHaveBeenCalled();
      expect(result.outcome).toBe("failed");
    });
  });

  describe("Given resultPublisher.publish itself throws on the failure path", () => {
    const movement = makeProcessing("deposit", {
      walletId: "w1",
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockRejectedValue(new Error("primary failure"));
      resultPublisher.publish.mockRejectedValueOnce(new Error("redis down"));
    });

    it("Then the use case still returns outcome=failed (the publisher error is logged but never propagated to QStash)", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(result.outcome).toBe("failed");
    });
  });

  describe("Given resultPublisher.publish throws a non-Error value on the failure path", () => {
    const movement = makeProcessing("deposit", {
      walletId: "w1",
      amountMinor: "100",
      idempotencyKey: "k",
      systemWalletShardCount: 32,
    });

    beforeEach(() => {
      movementRepo.markProcessing.mockResolvedValue(movement);
      depositService.execute.mockRejectedValue(new Error("primary failure"));
      resultPublisher.publish.mockRejectedValueOnce("publish-string-error");
    });

    it("Then the use case still returns outcome=failed", async () => {
      const result = await sut.handle(ctx, new ProcessMovementCommand(MOV_ID));
      expect(result.outcome).toBe("failed");
    });
  });
});
