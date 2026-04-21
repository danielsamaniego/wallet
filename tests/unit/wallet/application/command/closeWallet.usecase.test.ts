import { mock, mockReset } from "vitest-mock-extended";
import { createMockLockRunner, createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CloseWalletUseCase } from "@/wallet/application/command/closeWallet/usecase.js";
import { CloseWalletCommand } from "@/wallet/application/command/closeWallet/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

describe("CloseWalletUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  const lockRunner = createMockLockRunner();
  const useCase = new CloseWalletUseCase(txManager, walletRepo, holdRepo, logger, lockRunner);

  const ctx = createTestContext();
  const WALLET_ID = "wallet-1";
  const PLATFORM_ID = "platform-1";

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
  });

  describe("Given an active wallet with zero balance and no active holds", () => {
    describe("When closing the wallet", () => {
      it("Then the wallet status becomes closed and is saved", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(0n)
          .withStatus("active")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.save.mockResolvedValue(undefined);
        holdRepo.countActiveHolds.mockResolvedValue(0);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);
        await useCase.handle(ctx, cmd);

        expect(wallet.status).toBe("closed");
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledWith(expect.anything(), wallet);
        expect(holdRepo.countActiveHolds).toHaveBeenCalledWith(expect.anything(), WALLET_ID);
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    describe("When closing the wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a wallet with non-zero balance", () => {
    describe("When closing the wallet", () => {
      it("Then it throws WALLET_BALANCE_NOT_ZERO", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(500n)
          .withStatus("active")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.countActiveHolds.mockResolvedValue(0);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_BALANCE_NOT_ZERO";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a wallet with active holds", () => {
    describe("When closing the wallet", () => {
      it("Then it throws WALLET_HAS_ACTIVE_HOLDS", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(0n)
          .withStatus("active")
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.countActiveHolds.mockResolvedValue(3);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_HAS_ACTIVE_HOLDS";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a system wallet", () => {
    describe("When closing the wallet", () => {
      it("Then it throws CANNOT_CLOSE_SYSTEM_WALLET", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asSystem()
          .withBalance(0n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.countActiveHolds.mockResolvedValue(0);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "CANNOT_CLOSE_SYSTEM_WALLET";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given an already closed wallet", () => {
    describe("When closing the wallet again", () => {
      it("Then it throws WALLET_CLOSED", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .asClosed()
          .withBalance(0n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.countActiveHolds.mockResolvedValue(0);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.DomainRule && err.code === "WALLET_CLOSED";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a wallet belonging to a different platform", () => {
    describe("When closing with a mismatched platformId", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .withBalance(0n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new CloseWalletCommand(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
        expect(walletRepo.save).not.toHaveBeenCalled();
        expect(holdRepo.countActiveHolds).not.toHaveBeenCalled();
      });
    });
  });
});
