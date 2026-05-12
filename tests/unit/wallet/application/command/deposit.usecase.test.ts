import { vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { DepositUseCase } from "@/wallet/application/command/deposit/usecase.js";
import { DepositCommand } from "@/wallet/application/command/deposit/command.js";
import type { DepositService } from "@/wallet/application/command/deposit/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

/**
 * Use case tests cover ONLY the orchestration layer: lock acquisition,
 * transaction envelope, Movement creation/save, and delegation to the
 * service. All business-rule behaviour (wallet validation, balance update,
 * ledger entries, platform mismatch, system wallet errors, etc.) lives in
 * `deposit.service.test.ts`.
 */
describe("DepositUseCase", () => {
  const txManager = createMockTransactionManager();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator(["mov-1"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const depositService = mock<DepositService>();

  const sut = new DepositUseCase(txManager, movementRepo, idGen, logger, lockRunner, depositService);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(depositService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    depositService.execute.mockResolvedValue({ transactionId: "tx-1", movementId: "mov-1" });
  });

  describe("Given a valid deposit command", () => {
    const cmd = new DepositCommand("wallet-1", "platform-1", 5000n, "idem-1", 32, "ref-1");

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

      it("Then it creates a Movement(type='deposit', status='posted') and saves it", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("deposit");
        expect(movement.status).toBe("posted");
      });

      it("Then it delegates to DepositService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(depositService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] = depositService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe("mov-1");
      });

      it("Then it returns whatever the service returned", async () => {
        depositService.execute.mockResolvedValue({
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
        depositService.execute.mockImplementation(async () => {
          order.push("service.execute");
          return { transactionId: "tx-1", movementId: "mov-1" };
        });

        await sut.handle(ctx, cmd);

        expect(order).toEqual(["movement.save", "service.execute"]);
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    const cmd = new DepositCommand("wallet-1", "platform-1", 5000n, "idem-2", 32);

    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        depositService.execute.mockRejectedValue(new Error("WALLET_NOT_FOUND"));

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("WALLET_NOT_FOUND");
      });
    });
  });
});
