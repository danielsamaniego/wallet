import { vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { WithdrawUseCase } from "@/wallet/application/command/withdraw/usecase.js";
import { WithdrawCommand } from "@/wallet/application/command/withdraw/command.js";
import type { WithdrawService } from "@/wallet/application/command/withdraw/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

describe("WithdrawUseCase", () => {
  const txManager = createMockTransactionManager();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator(["mov-1"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const withdrawService = mock<WithdrawService>();

  const sut = new WithdrawUseCase(
    txManager,
    movementRepo,
    idGen,
    logger,
    lockRunner,
    withdrawService,
  );
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(withdrawService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    withdrawService.execute.mockResolvedValue({ transactionId: "tx-1", movementId: "mov-1" });
  });

  describe("Given a valid withdrawal command", () => {
    const cmd = new WithdrawCommand("wallet-1", "platform-1", 3000n, "idem-1", 32, "ref-1");

    describe("When handle is called", () => {
      it("Then it acquires the per-wallet lock with key `wallet-lock:<walletId>`", async () => {
        await sut.handle(ctx, cmd);

        expect(lockRunner.run).toHaveBeenCalledWith(
          expect.anything(),
          ["wallet-lock:wallet-1"],
          expect.any(Function),
        );
      });

      it("Then it opens a transaction via txManager.run", async () => {
        await sut.handle(ctx, cmd);

        expect(txManager.run).toHaveBeenCalledOnce();
      });

      it("Then it creates a Movement(type='withdrawal', status='posted') and saves it", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("withdrawal");
        expect(movement.status).toBe("posted");
      });

      it("Then it delegates to WithdrawService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(withdrawService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] = withdrawService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe("mov-1");
      });

      it("Then it returns whatever the service returned", async () => {
        withdrawService.execute.mockResolvedValue({
          transactionId: "tx-from-service",
          movementId: "mov-1",
        });

        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-from-service", movementId: "mov-1" });
      });

      it("Then the Movement is saved before the service runs (FK ordering)", async () => {
        const order: string[] = [];
        movementRepo.save.mockImplementation(async () => {
          order.push("movement.save");
        });
        withdrawService.execute.mockImplementation(async () => {
          order.push("service.execute");
          return { transactionId: "tx-1", movementId: "mov-1" };
        });

        await sut.handle(ctx, cmd);

        expect(order).toEqual(["movement.save", "service.execute"]);
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    const cmd = new WithdrawCommand("wallet-1", "platform-1", 3000n, "idem-2", 32);

    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        withdrawService.execute.mockRejectedValue(new Error("INSUFFICIENT_FUNDS"));

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("INSUFFICIENT_FUNDS");
      });
    });
  });
});
