import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { UpdatePlatformConfigUseCase } from "@/platform/application/command/updatePlatformConfig/usecase.js";
import { UpdatePlatformConfigCommand } from "@/platform/application/command/updatePlatformConfig/command.js";
import type { IPlatformRepository } from "@/platform/domain/ports/platform.repository.js";
import { Platform } from "@/platform/domain/platform/platform.aggregate.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("UpdatePlatformConfigUseCase", () => {
  const platformRepo = mock<IPlatformRepository>();
  const logger = createMockLogger();

  const sut = new UpdatePlatformConfigUseCase(platformRepo, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(platformRepo);
  });

  // ── Happy path ──────────────────────────────────────────────────────

  describe("Given an active platform with allowNegativeBalance=false", () => {
    const platform = Platform.reconstruct(
      "plat-1",
      "Acme Corp",
      "hash",
      "kid-1",
      "active",
      false,
      1000,
      1000,
    );

    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(platform);
      platformRepo.save.mockResolvedValue(undefined);
    });

    describe("When setting allowNegativeBalance to true", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-1", true);

      it("Then returns the platformId", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ platformId: "plat-1" });
      });

      it("Then saves the platform with allowNegativeBalance=true", async () => {
        await sut.handle(ctx, cmd);

        expect(platformRepo.save).toHaveBeenCalledOnce();
        const saved = platformRepo.save.mock.calls[0]![1] as Platform;
        expect(saved.allowNegativeBalance).toBe(true);
      });
    });

    describe("When setting allowNegativeBalance to false (idempotent)", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-1", false);

      it("Then saves the platform with allowNegativeBalance=false", async () => {
        await sut.handle(ctx, cmd);

        const saved = platformRepo.save.mock.calls[0]![1] as Platform;
        expect(saved.allowNegativeBalance).toBe(false);
      });
    });
  });

  // ── Platform not found ──────────────────────────────────────────────

  describe("Given the platform does not exist", () => {
    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(null);
    });

    describe("When updating config", () => {
      const cmd = new UpdatePlatformConfigCommand("nonexistent", true);

      it("Then throws PLATFORM_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "PLATFORM_NOT_FOUND";
        });
      });
    });
  });

  // ── Revoked platform ────────────────────────────────────────────────

  describe("Given a revoked platform", () => {
    const revokedPlatform = Platform.reconstruct(
      "plat-rev",
      "Revoked",
      "hash",
      "kid-rev",
      "revoked",
      false,
      1000,
      1000,
    );

    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(revokedPlatform);
    });

    describe("When updating config", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-rev", true);

      it("Then throws PLATFORM_REVOKED", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "PLATFORM_REVOKED";
        });
      });
    });
  });
});
