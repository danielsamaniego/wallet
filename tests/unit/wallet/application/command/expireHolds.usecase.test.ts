import { describe, it, expect, beforeEach, vi } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ExpireHoldsUseCase } from "@/wallet/application/command/expireHolds/usecase.js";
import { ExpireHoldsCommand } from "@/wallet/application/command/expireHolds/command.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";

describe("ExpireHoldsUseCase", () => {
  const holdRepo = mock<IHoldRepository>();
  const logger = createMockLogger();
  const ctx = createTestContext();

  const useCase = new ExpireHoldsUseCase(holdRepo, logger);

  beforeEach(() => {
    mockReset(holdRepo);
    (logger.info as ReturnType<typeof vi.fn>).mockClear();
  });

  describe("Given overdue holds exist", () => {
    describe("When expiring holds", () => {
      it("Then calls expireOverdue and returns the count", async () => {
        holdRepo.expireOverdue.mockResolvedValue(5);

        const cmd = new ExpireHoldsCommand();
        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ expiredCount: 5 });
        expect(holdRepo.expireOverdue).toHaveBeenCalledOnce();
        expect(holdRepo.expireOverdue).toHaveBeenCalledWith(ctx);
      });

      it("Then logs the count when holds are expired", async () => {
        holdRepo.expireOverdue.mockResolvedValue(3);

        const cmd = new ExpireHoldsCommand();
        await useCase.handle(ctx, cmd);

        expect(logger.info).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("3"),
        );
      });
    });
  });

  describe("Given no overdue holds exist", () => {
    describe("When expiring holds", () => {
      it("Then returns zero and does not log info", async () => {
        holdRepo.expireOverdue.mockResolvedValue(0);

        const cmd = new ExpireHoldsCommand();
        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ expiredCount: 0 });
        expect(holdRepo.expireOverdue).toHaveBeenCalledOnce();
        expect(logger.info).not.toHaveBeenCalled();
      });
    });
  });
});
