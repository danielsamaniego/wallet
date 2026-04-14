import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { UnfreezeWalletUseCase } from "@/wallet/application/command/unfreezeWallet/usecase.js";
import { UnfreezeWalletCommand } from "@/wallet/application/command/unfreezeWallet/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("UnfreezeWalletUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  const useCase = new UnfreezeWalletUseCase(txManager, walletRepo, logger);

  const ctx = createTestContext();
  const WALLET_ID = "wallet-1";
  const PLATFORM_ID = "platform-1";

  beforeEach(() => {
    mockReset(walletRepo);
  });

  describe("Given a frozen wallet", () => {
    describe("When unfreezing the wallet", () => {
      it("Then the wallet status becomes active and is saved", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asFrozen()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.save.mockResolvedValue(undefined);

        const cmd = new UnfreezeWalletCommand(WALLET_ID, PLATFORM_ID);
        await useCase.handle(ctx, cmd);

        expect(wallet.status).toBe("active");
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledWith(expect.anything(), wallet);
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    describe("When unfreezing the wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new UnfreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given an active wallet (not frozen)", () => {
    describe("When unfreezing the wallet", () => {
      it("Then it throws WALLET_NOT_FROZEN", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withStatus("active")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new UnfreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_NOT_FROZEN";
        });
      });
    });
  });

  describe("Given a wallet belonging to a different platform", () => {
    describe("When unfreezing with a mismatched platformId", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .asFrozen()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new UnfreezeWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
