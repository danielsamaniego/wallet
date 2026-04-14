import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockIDGenerator, createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { PlaceHoldUseCase } from "@/wallet/application/command/placeHold/usecase.js";
import { PlaceHoldCommand } from "@/wallet/application/command/placeHold/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const PLATFORM_ID = "platform-1";
const WALLET_ID = "wallet-1";
const HOLD_ID = "hold-1";

describe("PlaceHoldUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const idGen = createMockIDGenerator([HOLD_ID]);
  const logger = createMockLogger();
  const txManager = createMockTransactionManager();
  const ctx = createTestContext();

  const useCase = new PlaceHoldUseCase(txManager, walletRepo, holdRepo, idGen, logger);

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    idGen.reset();
  });

  describe("Given an active wallet with sufficient available balance", () => {
    describe("When placing a hold", () => {
      it("Then returns the holdId and persists wallet + hold", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .withVersion(1)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.sumActiveHolds.mockResolvedValue(0n);
        walletRepo.save.mockResolvedValue(undefined);
        holdRepo.save.mockResolvedValue(undefined);

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 2000n, "ref-1", undefined);
        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ holdId: HOLD_ID });
        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(holdRepo.save).toHaveBeenCalledOnce();

        // Wallet version should have been bumped via touchForHoldChange
        const savedWallet = walletRepo.save.mock.calls[0]![1];
        expect(savedWallet.version).toBe(2);
      });
    });
  });

  describe("Given a wallet where available balance equals the hold amount (boundary)", () => {
    describe("When placing a hold for the exact available amount", () => {
      it("Then succeeds and returns the holdId", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(3000n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.sumActiveHolds.mockResolvedValue(1000n); // available = 3000 - 1000 = 2000
        walletRepo.save.mockResolvedValue(undefined);
        holdRepo.save.mockResolvedValue(undefined);

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 2000n);
        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ holdId: HOLD_ID });
      });
    });
  });

  describe("Given a wallet with insufficient available balance", () => {
    describe("When placing a hold exceeding available funds", () => {
      it("Then throws INSUFFICIENT_FUNDS", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(3000n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.sumActiveHolds.mockResolvedValue(2000n); // available = 1000

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 1500n);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "INSUFFICIENT_FUNDS";
        });

        expect(walletRepo.save).not.toHaveBeenCalled();
        expect(holdRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a frozen wallet", () => {
    describe("When placing a hold", () => {
      it("Then throws WALLET_NOT_ACTIVE", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .asFrozen()
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 1000n);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "WALLET_NOT_ACTIVE";
        });

        expect(holdRepo.sumActiveHolds).not.toHaveBeenCalled();
        expect(walletRepo.save).not.toHaveBeenCalled();
        expect(holdRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a platform mismatch", () => {
    describe("When placing a hold with a different platformId", () => {
      it("Then throws WALLET_NOT_FOUND", async () => {
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .withBalance(5000n)
          .build();

        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 1000n);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });

        expect(holdRepo.sumActiveHolds).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a non-existent wallet", () => {
    describe("When placing a hold", () => {
      it("Then throws WALLET_NOT_FOUND", async () => {
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new PlaceHoldCommand(WALLET_ID, PLATFORM_ID, 1000n);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
