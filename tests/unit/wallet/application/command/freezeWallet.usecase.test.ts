import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { FreezeWalletUseCase } from "@/wallet/application/command/freezeWallet/usecase.js";
import { FreezeWalletCommand } from "@/wallet/application/command/freezeWallet/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("FreezeWalletUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  const useCase = new FreezeWalletUseCase(txManager, walletRepo, logger);

  const ctx = createTestContext();
  const WALLET_ID = "wallet-1";
  const PLATFORM_ID = "platform-1";

  beforeEach(() => {
    mockReset(walletRepo);
  });

  describe("Given an active wallet", () => {
    describe("When freezing the wallet", () => {
      it("Then the wallet status becomes frozen and is saved", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withStatus("active")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.save.mockResolvedValue(undefined);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);
        await useCase.handle(ctx, cmd);

        expect(wallet.status).toBe("frozen");
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledWith(expect.anything(), wallet);
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    describe("When freezing the wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a system wallet", () => {
    describe("When freezing the wallet", () => {
      it("Then it throws CANNOT_FREEZE_SYSTEM_WALLET", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "CANNOT_FREEZE_SYSTEM_WALLET";
        });
      });
    });
  });

  describe("Given an already frozen wallet", () => {
    describe("When freezing the wallet again", () => {
      it("Then it throws WALLET_ALREADY_FROZEN", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asFrozen()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_ALREADY_FROZEN";
        });
      });
    });
  });

  describe("Given a closed wallet", () => {
    describe("When freezing the wallet", () => {
      it("Then it throws WALLET_CLOSED", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asClosed()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_CLOSED";
        });
      });
    });
  });

  describe("Given a wallet belonging to a different platform", () => {
    describe("When freezing with a mismatched platformId", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new FreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
