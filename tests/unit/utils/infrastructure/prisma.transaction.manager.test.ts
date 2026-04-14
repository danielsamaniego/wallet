import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaTransactionManager } from "@/utils/infrastructure/prisma.transaction.manager.js";
import { AppError } from "@/utils/kernel/appError.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/index.js";
import type { PrismaClient } from "@prisma/client";

function buildManager(prismaOverride?: Partial<PrismaClient>) {
  const logger = createMockLogger();
  const prisma = {
    $transaction: vi.fn(),
    ...prismaOverride,
  } as unknown as PrismaClient;

  const manager = new PrismaTransactionManager(prisma, logger);
  return { manager, prisma, logger };
}

describe("PrismaTransactionManager", () => {
  const ctx = createTestContext();

  describe("run — happy path", () => {
    it("Given a successful callback, When run is called, Then returns the result and commits", async () => {
      // Given
      const { manager, prisma } = buildManager();
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: Function) =>
        fn({ isTx: true }),
      );

      // When
      const result = await manager.run(ctx, async (txCtx) => {
        expect(txCtx.opCtx).toEqual({ isTx: true });
        return 42;
      });

      // Then
      expect(result).toBe(42);
    });
  });

  describe("run — retry on VERSION_CONFLICT (domain optimistic lock)", () => {
    it("Given a VERSION_CONFLICT on first attempt, When run is called, Then retries and succeeds", async () => {
      // Given
      const { manager, prisma, logger } = buildManager();
      let callCount = 0;
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: Function) => {
        callCount++;
        if (callCount === 1) {
          throw AppError.conflict("VERSION_CONFLICT", "version mismatch");
        }
        return fn({});
      });

      // When
      const result = await manager.run(ctx, async () => "ok");

      // Then
      expect(result).toBe("ok");
      expect(callCount).toBe(2);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("run — retry on Prisma P2034 serialization failure", () => {
    it("Given a P2034 error on first attempt, When run is called, Then retries and succeeds", async () => {
      // Given
      const { manager, prisma } = buildManager();
      let callCount = 0;
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: Function) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("serialization failure") as Error & { code: string };
          err.code = "P2034";
          throw err;
        }
        return fn({});
      });

      // When
      const result = await manager.run(ctx, async () => "ok");

      // Then
      expect(result).toBe("ok");
      expect(callCount).toBe(2);
    });
  });

  describe("run — retry on 'could not serialize access' message", () => {
    it("Given a serialization message error, When run is called, Then retries and succeeds", async () => {
      // Given
      const { manager, prisma } = buildManager();
      let callCount = 0;
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: Function) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("could not serialize access due to concurrent update");
        }
        return fn({});
      });

      // When
      const result = await manager.run(ctx, async () => "ok");

      // Then
      expect(result).toBe("ok");
      expect(callCount).toBe(2);
    });
  });

  describe("run — retries exhausted on serialization failure (non-AppError)", () => {
    it("Given serialization failures on all 3 attempts, When run is called, Then throws VERSION_CONFLICT AppError", async () => {
      // Given
      const { manager, prisma, logger } = buildManager();
      const serialError = new Error("could not serialize access") as Error & { code: string };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(serialError);

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toSatisfy((err: unknown) => {
        return AppError.is(err) && err.code === "VERSION_CONFLICT";
      });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("run — retries exhausted on VERSION_CONFLICT (AppError)", () => {
    it("Given VERSION_CONFLICT AppError on all 3 attempts, When run is called, Then re-throws the original AppError", async () => {
      // Given
      const { manager, prisma } = buildManager();
      const conflict = AppError.conflict("VERSION_CONFLICT", "stale version");
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(conflict);

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toBe(conflict);
    });
  });

  describe("run — non-retryable error", () => {
    it("Given a non-retryable error, When run is called, Then throws immediately without retry", async () => {
      // Given
      const { manager, prisma } = buildManager();
      let callCount = 0;
      const nonRetryable = new Error("some other error");
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        throw nonRetryable;
      });

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toBe(nonRetryable);
      expect(callCount).toBe(1);
    });
  });

  describe("run — non-Error thrown value logs 'unknown'", () => {
    it("Given the transaction throws a non-Error value, When run is called, Then logs 'unknown' in rollback and throws", async () => {
      // Given
      const { manager, prisma, logger } = buildManager();
      const nonError = "string-error";
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(nonError);

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toBe(nonError);
      // The rollback log should have error: "unknown" since the thrown value is not an Error
      expect(logger.debug).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining("rollback"),
        expect.objectContaining({ error: "unknown" }),
      );
    });
  });

  describe("isRetryable — null error", () => {
    it("Given null is thrown, When run is called, Then it is not retried and throws immediately", async () => {
      // Given
      const { manager, prisma } = buildManager();
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(null);

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toBe(null);
    });
  });

  describe("run — P2034 retries exhausted escalated to VERSION_CONFLICT", () => {
    it("Given P2034 error on all attempts, When run exhausts retries, Then escalates to VERSION_CONFLICT", async () => {
      // Given
      const { manager, prisma, logger } = buildManager();
      const p2034 = Object.assign(new Error("P2034"), { code: "P2034" });
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(p2034);

      // When / Then
      await expect(manager.run(ctx, async () => "never")).rejects.toSatisfy((err: unknown) => {
        return AppError.is(err) && err.code === "VERSION_CONFLICT";
      });
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
