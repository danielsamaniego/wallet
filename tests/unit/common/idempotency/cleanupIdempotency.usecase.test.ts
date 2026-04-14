import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CleanupIdempotencyUseCase } from "@/common/idempotency/application/command/cleanupIdempotency/usecase.js";
import { CleanupIdempotencyCommand } from "@/common/idempotency/application/command/cleanupIdempotency/command.js";
import type { IIdempotencyStore } from "@/common/idempotency/application/ports/idempotency.store.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("CleanupIdempotencyUseCase", () => {
  const idempotencyStore = mock<IIdempotencyStore>();
  const logger: ILogger = createMockLogger();
  const useCase = new CleanupIdempotencyUseCase(idempotencyStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(idempotencyStore);
    vi.mocked(logger.info).mockClear();
  });

  // ── Expired records exist ──────────────────────────────────────

  describe("Given expired idempotency records exist", () => {
    beforeEach(() => {
      idempotencyStore.deleteExpired.mockResolvedValue(5);
    });

    describe("When the cleanup command is handled", () => {
      it("Then it deletes expired records and returns the count", async () => {
        const cmd = new CleanupIdempotencyCommand();

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ deletedCount: 5 });
        expect(idempotencyStore.deleteExpired).toHaveBeenCalledWith(ctx);
      });

      it("Then it logs the deletion count", async () => {
        const cmd = new CleanupIdempotencyCommand();

        await useCase.handle(ctx, cmd);

        expect(logger.info).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("deleted 5 expired records"),
        );
      });
    });
  });

  // ── No expired records ─────────────────────────────────────────

  describe("Given no expired idempotency records exist", () => {
    beforeEach(() => {
      idempotencyStore.deleteExpired.mockResolvedValue(0);
    });

    describe("When the cleanup command is handled", () => {
      it("Then it returns deletedCount of 0", async () => {
        const cmd = new CleanupIdempotencyCommand();

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ deletedCount: 0 });
        expect(idempotencyStore.deleteExpired).toHaveBeenCalledWith(ctx);
      });

      it("Then it does NOT log (nothing to report)", async () => {
        const cmd = new CleanupIdempotencyCommand();

        await useCase.handle(ctx, cmd);

        expect(logger.info).not.toHaveBeenCalled();
      });
    });
  });
});
