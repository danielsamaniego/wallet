// TODO(historical-import-temp): Remove this test file together with the rest
// of the import-historical-entry feature after migration.
import { vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ImportHistoricalEntryUseCase } from "@/wallet/application/command/importHistoricalEntry/usecase.js";
import { ImportHistoricalEntryCommand } from "@/wallet/application/command/importHistoricalEntry/command.js";
import type { ImportHistoricalEntryService } from "@/wallet/application/command/importHistoricalEntry/service.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

const HISTORICAL_AT = 1_726_000_000_000;

describe("ImportHistoricalEntryUseCase", () => {
  const txManager = createMockTransactionManager();
  const movementRepo = mock<IMovementRepository>();
  const idGen = createMockIDGenerator(["mov-1"]);
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const importHistoricalEntryService = mock<ImportHistoricalEntryService>();

  const sut = new ImportHistoricalEntryUseCase(
    txManager,
    movementRepo,
    idGen,
    logger,
    lockRunner,
    importHistoricalEntryService,
  );
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(importHistoricalEntryService);
    (txManager.run as ReturnType<typeof vi.fn>).mockClear();
    (lockRunner.run as ReturnType<typeof vi.fn>).mockClear();
    idGen.reset();
    importHistoricalEntryService.execute.mockResolvedValue({
      transactionId: "tx-1",
      movementId: "mov-1",
    });
  });

  describe("Given a valid historical import command", () => {
    const cmd = new ImportHistoricalEntryCommand(
      "wallet-1",
      "platform-1",
      5000n,
      "Legacy promotional credit",
      "Venta producto X",
      "idem-1",
      HISTORICAL_AT,
      32,
      { migratedFrom: "legacy-system" },
    );

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

      it("Then it creates a Movement(type='adjustment') stamped with the historical timestamp + reason", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const movement = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(movement.id).toBe("mov-1");
        expect(movement.type).toBe("adjustment");
        expect(movement.status).toBe("posted");
        expect(movement.reason).toBe("Legacy promotional credit");
        expect(movement.createdAt).toBe(HISTORICAL_AT);
      });

      it("Then it delegates to ImportHistoricalEntryService.execute with the saved Movement", async () => {
        await sut.handle(ctx, cmd);

        expect(importHistoricalEntryService.execute).toHaveBeenCalledOnce();
        const [, calledCmd, calledMovement] =
          importHistoricalEntryService.execute.mock.calls[0]!;
        expect(calledCmd).toBe(cmd);
        expect((calledMovement as Movement).id).toBe("mov-1");
      });

      it("Then it returns whatever the service returned", async () => {
        importHistoricalEntryService.execute.mockResolvedValue({
          transactionId: "tx-from-service",
          movementId: "mov-1",
        });

        const result = await sut.handle(ctx, cmd);

        expect(result).toEqual({ transactionId: "tx-from-service", movementId: "mov-1" });
      });
    });
  });

  describe("Given the service throws (business-rule failure)", () => {
    const cmd = new ImportHistoricalEntryCommand(
      "wallet-1",
      "platform-1",
      1000n,
      "reason",
      "ref",
      "idem-2",
      HISTORICAL_AT,
      32,
    );

    describe("When handle is called", () => {
      it("Then the error propagates out of the lock + tx envelope", async () => {
        importHistoricalEntryService.execute.mockRejectedValue(
          new Error("ADJUST_WOULD_BREAK_ACTIVE_HOLDS"),
        );

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("ADJUST_WOULD_BREAK_ACTIVE_HOLDS");
      });
    });
  });
});
