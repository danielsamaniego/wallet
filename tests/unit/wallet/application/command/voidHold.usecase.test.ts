import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockLockRunner,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
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
  const lockRunner = createMockLockRunner();
  const ctx = createTestContext();

  const useCase = new VoidHoldUseCase(txManager, walletRepo, holdRepo, logger, lockRunner);

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
        holdRepo.transitionStatus.mockResolvedValue(undefined);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);
        await useCase.handle(ctx, cmd);

        expect(hold.status).toBe("voided");
        expect(wallet.version).toBe(2); // touchForHoldChange bumps version

        expect(walletRepo.save).toHaveBeenCalledOnce();
        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
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
        holdRepo.transitionStatus.mockResolvedValue(undefined);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.DomainRule && err.code === "HOLD_EXPIRED";
        });

        // Hold should be transitioned to expired
        expect(holdRepo.transitionStatus).toHaveBeenCalledOnce();
        expect(hold.status).toBe("expired");

        // Wallet should NOT have been saved (we threw before that)
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that does not exist", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_FOUND from the pre-lookup and never enters the transaction", async () => {
        holdRepo.findById.mockResolvedValue(null);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        expect(walletRepo.findById).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold that disappears between the pre-lookup and the transaction", () => {
    describe("When voiding the hold", () => {
      it("Then throws HOLD_NOT_FOUND from the inner re-read (defensive guard)", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(2000n)
          .build();
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .build();

        // Pre-lookup hold + wallet (platform check) succeed; inside the tx the
        // hold has vanished.
        holdRepo.findById.mockResolvedValueOnce(hold).mockResolvedValueOnce(null);
        walletRepo.findById.mockResolvedValueOnce(wallet);

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        expect(walletRepo.findById).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Given wallet deleted between pre-lock and transaction (race)", () => {
    describe("When voiding the hold", () => {
      it("Then the inner tx re-read defends by throwing HOLD_NOT_FOUND", async () => {
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(1000n)
          .build();
        const wallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(PLATFORM_ID)
          .build();

        holdRepo.findById.mockResolvedValue(hold);
        walletRepo.findById
          .mockResolvedValueOnce(wallet) // pre-lock guard passes
          .mockResolvedValueOnce(null); // inner tx race

        const cmd = new VoidHoldCommand(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        expect(holdRepo.transitionStatus).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a hold belonging to ANOTHER platform's wallet (cross-tenant)", () => {
    describe("When voidHold is invoked with the attacker's platformId", () => {
      it("Then throws HOLD_NOT_FOUND BEFORE acquiring the lock and never enters the transaction", async () => {
        const victimPlatformId = "platform-victim";
        const attackerPlatformId = "platform-attacker";
        const hold = new HoldBuilder()
          .withId(HOLD_ID)
          .withWalletId(WALLET_ID)
          .withAmount(2000n)
          .build();
        const victimWallet = new WalletBuilder()
          .withId(WALLET_ID)
          .withPlatformId(victimPlatformId) // belongs to the victim
          .build();

        holdRepo.findById.mockResolvedValueOnce(hold);
        walletRepo.findById.mockResolvedValueOnce(victimWallet);

        const cmd = new VoidHoldCommand(HOLD_ID, attackerPlatformId);

        await expect(useCase.handle(ctx, cmd)).rejects.toSatisfy((err: unknown) => {
          return AppError.is(err) && err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });

        // Tx never ran — no inner re-reads, no transitions, no writes.
        expect(holdRepo.findById).toHaveBeenCalledTimes(1);
        expect(holdRepo.transitionStatus).not.toHaveBeenCalled();
        expect(walletRepo.save).not.toHaveBeenCalled();
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
