import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger, createMockTransactionManager } from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { HoldBuilder } from "@test/helpers/builders/hold.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { VoidHoldUseCase } from "@/wallet/application/command/voidHold/usecase.js";
import { VoidHoldCommand } from "@/wallet/application/command/voidHold/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const PLATFORM_ID = "platform-1";
const WALLET_ID = "wallet-1";
const HOLD_ID = "hold-1";

describe("VoidHoldUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const logger = createMockLogger();
  const txManager = createMockTransactionManager();
  const ctx = createTestContext();

  const useCase = new VoidHoldUseCase(txManager, walletRepo, holdRepo, logger);

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
  });

  describe("Given an active hold on an active wallet", () => {
    describe("When voiding the hold", () => {
      it("Then voids the hold and bumps wallet version", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(2000n)
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .withVersion(1)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        walletRepo.save.mockResolvedValue(undefined);
        holdRepo.save.mockResolvedValue(undefined);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);
        await useCase.handle(ctx, cmd);

        expect(hold.status).toBe("voided");
        expect(wallet.version).toBe(2); // touchForHoldChange bumps version

        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(holdRepo.save).toHaveBeenCalledOnce();
      });
    });
  });

  describe("Given an active hold that has expired (lazy check)", () => {
    describe("When voiding the hold", () => {
      it("Then saves hold as expired and throws HOLD_EXPIRED", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .withExpiresAt(1) // expired long ago
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);
        holdRepo.save.mockResolvedValue(undefined);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_EXPIRED";
        });

        // Hold should be saved as expired
        expect(holdRepo.save).toHaveBeenCalledOnce();
        expect(hold.status).toBe("expired");

        // Wallet should NOT have been saved (we threw before that)
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that does not exist", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_FOUND", async () => {
        holdRepo.findById.mockResolvedValue(null);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        expect(walletRepo.findById).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that is not active (already captured)", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_ACTIVE", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .asCaptured()
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        // hold.void_(now) will throw HOLD_NOT_ACTIVE
        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_NOT_ACTIVE";
        });

        expect(walletRepo.save).not.toHaveBeenCalled();
        expect(holdRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a platform mismatch between command and wallet", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();

        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId("other-platform")
          .withBalance(5000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(wallet);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        // VoidHold use case throws ErrHoldNotFound on platform mismatch
        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a wallet that does not exist for the hold", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById.mockResolvedValue(null);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });
      });
    });
  });
});
