import { vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { TransferUseCase } from "@/wallet/application/command/transfer/usecase.js";
import { TransferCommand } from "@/wallet/application/command/transfer/command.js";
import type { TransferService } from "@/wallet/application/command/transfer/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

const PLATFORM = "platform-1";
const IDEM = "idem-1";

describe("TransferUseCase", () => {
  const txManager = createMockTransactionManager();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator(["mov-1"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const transferService = mock<TransferService>();

  const sut = new TransferUseCase(
    txManager,
    movementRepo,
    idGen,
    logger,
    lockRunner,
    transferService,
  );
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(transferService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    transferService.execute.mockResolvedValue({
      sourceTransactionId: "tx-out-1",
      targetTransactionId: "tx-in-1",
      movementId: "mov-1",
    });
  });

  describe("Given a valid transfer command", () => {
    const cmd = new TransferCommand("wallet-source", "wallet-target", PLATFORM, 2500n, IDEM);

    describe("When handle is called", () => {
      it("Then it acquires per-wallet locks on BOTH wallets", async () => {
        await sut.handle(ctx, cmd);

        expect(lockRunner.run).toHaveBeenCalledWith(
          expect.anything(),
          ["wallet-lock:wallet-source", "wallet-lock:wallet-target"],
          expect.any(Function),
        );
      });

      it("Then it opens a transaction via txManager.run", async () => {
        await sut.handle(ctx, cmd);

        expect(txManager.run).toHaveBeenCalledOnce();
      });

      it("Then it creates a Movement(type='transfer', status='posted') and saves it", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("transfer");
        expect(movement.status).toBe("posted");
      });

      it("Then it delegates to TransferService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(transferService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] = transferService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe("mov-1");
      });

      it("Then it returns whatever the service returned", async () => {
        transferService.execute.mockResolvedValue({
          sourceTransactionId: "service-tx-out",
          targetTransactionId: "service-tx-in",
          movementId: "mov-1",
        });

        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({
          sourceTransactionId: "service-tx-out",
          targetTransactionId: "service-tx-in",
          movementId: "mov-1",
        });
      });

      it("Then the Movement is saved before the service runs (FK ordering)", async () => {
        const order: string[] = [];
        movementRepo.save.mockImplementation(async () => {
          order.push("movement.save");
        });
        transferService.execute.mockImplementation(async () => {
          order.push("service.execute");
          return {
            sourceTransactionId: "tx-out-1",
            targetTransactionId: "tx-in-1",
            movementId: "mov-1",
          };
        });

        await sut.handle(ctx, cmd);

        expect(order).toEqual(["movement.save", "service.execute"]);
      });
    });
  });

  describe("Given source and target are the same wallet", () => {
    describe("When a transfer is attempted", () => {
      it("Then it throws SAME_WALLET without acquiring a lock or opening a transaction", async () => {
        const cmd = new TransferCommand("wallet-x", "wallet-x", PLATFORM, 1000n, IDEM);

        const err = await sut.handle(ctx, cmd).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({ code: "SAME_WALLET", kind: ErrorKind.Validation });
        expect(lockRunner.run).not.toHaveBeenCalled();
        expect(txManager.run).not.toHaveBeenCalled();
        expect(transferService.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    const cmd = new TransferCommand("wallet-source", "wallet-target", PLATFORM, 1000n, IDEM);

    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        transferService.execute.mockRejectedValue(new Error("CURRENCY_MISMATCH"));

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("CURRENCY_MISMATCH");
      });
    });
  });
});
