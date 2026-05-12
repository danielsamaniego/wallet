import { vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ChargeUseCase } from "@/wallet/application/command/charge/usecase.js";
import { ChargeCommand } from "@/wallet/application/command/charge/command.js";
import type { ChargeService } from "@/wallet/application/command/charge/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

describe("ChargeUseCase", () => {
  const txManager = createMockTransactionManager();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator(["mov-1"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const chargeService = mock<ChargeService>();

  const sut = new ChargeUseCase(txManager, movementRepo, idGen, logger, lockRunner, chargeService);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(chargeService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    chargeService.execute.mockResolvedValue({ transactionId: "tx-1", movementId: "mov-1" });
  });

  describe("Given a valid charge command", () => {
    const cmd = new ChargeCommand("wallet-1", "platform-1", 3000n, "idem-1", 32, "COMMISSION");

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

      it("Then it creates a Movement(type='charge', status='posted') and saves it", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("charge");
        expect(movement.status).toBe("posted");
      });

      it("Then it delegates to ChargeService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(chargeService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] = chargeService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe("mov-1");
      });

      it("Then it returns whatever the service returned", async () => {
        chargeService.execute.mockResolvedValue({
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
        chargeService.execute.mockImplementation(async () => {
          order.push("service.execute");
          return { transactionId: "tx-1", movementId: "mov-1" };
        });

        await sut.handle(ctx, cmd);

        expect(order).toEqual(["movement.save", "service.execute"]);
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    const cmd = new ChargeCommand("wallet-1", "platform-1", 3000n, "idem-2", 32);

    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        chargeService.execute.mockRejectedValue(new Error("INSUFFICIENT_FUNDS"));

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("INSUFFICIENT_FUNDS");
      });
    });
  });
});
