import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { UpdatePlatformConfigUseCase } from "@/platform/application/command/updatePlatformConfig/usecase.js";
import { UpdatePlatformConfigCommand } from "@/platform/application/command/updatePlatformConfig/command.js";
import type { IPlatformRepository } from "@/platform/domain/ports/platform.repository.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import { Platform } from "@/platform/domain/platform/platform.aggregate.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("UpdatePlatformConfigUseCase", () => {
  const platformRepo = mock<IPlatformRepository>();
  const walletRepo = mock<IWalletRepository>();
  const logger = createMockLogger();
  const txManager = createMockTransactionManager();

  const sut = new UpdatePlatformConfigUseCase(txManager, platformRepo, walletRepo, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(platformRepo);
    mockReset(walletRepo);
  });

  describe("Given an active platform with allowNegativeBalance=false", () => {
    const freshPlatform = () =>
      Platform.reconstruct("plat-1", "Acme Corp", "hash", "kid-1", "active", false, 32, 1000, 1000);

    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(freshPlatform());
      platformRepo.save.mockResolvedValue(undefined);
      walletRepo.listSystemWalletCurrencies.mockResolvedValue([]);
      walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
    });

    describe("When setting allowNegativeBalance to true (no shard change)", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-1", true, undefined);

      it("Then saves the platform with allowNegativeBalance=true", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ platformId: "plat-1" });
        const saved = platformRepo.save.mock.calls[0]![1] as Platform;
        expect(saved.allowNegativeBalance).toBe(true);
        expect(walletRepo.listSystemWalletCurrencies).not.toHaveBeenCalled();
      });
    });

    describe("When setting systemWalletShardCount alone (no negative-balance change)", () => {
      beforeEach(() => {
        walletRepo.listSystemWalletCurrencies.mockResolvedValue(["EUR", "USD"]);
      });

      it("Then bumps the count on the platform and eagerly materialises shards for each currency in use", async () => {
        const cmd = new UpdatePlatformConfigCommand("plat-1", undefined, 64);
        await sut.handle(ctx, cmd);

        const saved = platformRepo.save.mock.calls[0]![1] as Platform;
        expect(saved.systemWalletShardCount).toBe(64);
        // allowNegativeBalance untouched
        expect(saved.allowNegativeBalance).toBe(false);

        expect(walletRepo.listSystemWalletCurrencies).toHaveBeenCalledWith(
          expect.anything(),
          "plat-1",
        );
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledTimes(2);
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledWith(
          expect.anything(),
          "plat-1",
          "EUR",
          64,
          expect.any(Number),
        );
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledWith(
          expect.anything(),
          "plat-1",
          "USD",
          64,
          expect.any(Number),
        );
      });
    });

    describe("When neither flag is provided (no-op command)", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-1", undefined, undefined);

      it("Then saves the untouched platform and does not touch the wallet repo", async () => {
        await sut.handle(ctx, cmd);
        expect(platformRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.listSystemWalletCurrencies).not.toHaveBeenCalled();
        expect(walletRepo.ensureSystemWalletShards).not.toHaveBeenCalled();
      });
    });

    describe("When decreasing the shard count is attempted", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-1", undefined, 16);

      it("Then throws SHARD_COUNT_DECREASE_NOT_ALLOWED without any side effects", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "SHARD_COUNT_DECREASE_NOT_ALLOWED";
        });
        expect(walletRepo.ensureSystemWalletShards).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given the platform does not exist", () => {
    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(null);
    });

    describe("When updating config", () => {
      const cmd = new UpdatePlatformConfigCommand("nonexistent", true, undefined);

      it("Then throws PLATFORM_NOT_FOUND", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "PLATFORM_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a revoked platform", () => {
    const revokedPlatform = () =>
      Platform.reconstruct("plat-rev", "Revoked", "hash", "kid-rev", "revoked", false, 32, 1000, 1000);

    beforeEach(() => {
      platformRepo.findById.mockResolvedValue(revokedPlatform());
    });

    describe("When updating config", () => {
      const cmd = new UpdatePlatformConfigCommand("plat-rev", true, undefined);

      it("Then throws PLATFORM_REVOKED", async () => {
        await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "PLATFORM_REVOKED";
        });
      });
    });
  });
});
