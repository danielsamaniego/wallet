import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { CreateWalletUseCase } from "@/wallet/application/command/createWallet/usecase.js";
import { CreateWalletCommand } from "@/wallet/application/command/createWallet/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

// ── Shared fixtures ────────────────────────────────────────────────

const PLATFORM = "platform-1";
const CURRENCY = "USD";
const OWNER = "owner-1";

const USER_WALLET_ID = "wallet-user-1";
const SYSTEM_WALLET_ID = "wallet-system-1";

// ── Test suite ─────────────────────────────────────────────────────

describe("CreateWalletUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  let idGen: ReturnType<typeof createMockIDGenerator>;
  let useCase: CreateWalletUseCase;
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(walletRepo);
  });

  // ── First wallet of a platform: auto-creates system wallet ─────

  describe("Given no wallets exist for the platform yet", () => {
    beforeEach(() => {
      // walletId for user, then sysId for system wallet
      idGen = createMockIDGenerator([USER_WALLET_ID, SYSTEM_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      walletRepo.findSystemWallet.mockResolvedValue(null);
    });

    describe("When a wallet is created", () => {
      it("Then it auto-creates the system wallet and the user wallet (2 saves)", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, CURRENCY);

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ walletId: USER_WALLET_ID });
        expect(walletRepo.save).toHaveBeenCalledTimes(2);

        // First save: system wallet
        const firstSaved = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(firstSaved.isSystem).toBe(true);
        expect(firstSaved.id).toBe(SYSTEM_WALLET_ID);
        expect(firstSaved.ownerId).toBe("SYSTEM");
        expect(firstSaved.platformId).toBe(PLATFORM);
        expect(firstSaved.currencyCode).toBe(CURRENCY);

        // Second save: user wallet
        const secondSaved = walletRepo.save.mock.calls[1]![1] as Wallet;
        expect(secondSaved.isSystem).toBe(false);
        expect(secondSaved.id).toBe(USER_WALLET_ID);
        expect(secondSaved.ownerId).toBe(OWNER);
        expect(secondSaved.platformId).toBe(PLATFORM);
        expect(secondSaved.currencyCode).toBe(CURRENCY);
      });
    });
  });

  // ── Second wallet: reuses existing system wallet ───────────────

  describe("Given a system wallet already exists for the platform", () => {
    const existingSystemWallet = new WalletBuilder()
      .withId("existing-sys-wallet")
      .asSystem()
      .withPlatformId(PLATFORM)
      .withCurrency(CURRENCY)
      .build();

    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      walletRepo.findSystemWallet.mockResolvedValue(existingSystemWallet);
    });

    describe("When a second wallet is created for the same platform", () => {
      it("Then it only saves the user wallet (1 save), reusing the existing system wallet", async () => {
        const cmd = new CreateWalletCommand("owner-2", PLATFORM, CURRENCY);

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ walletId: USER_WALLET_ID });
        expect(walletRepo.save).toHaveBeenCalledOnce();

        // The only save is the user wallet
        const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(savedWallet.isSystem).toBe(false);
        expect(savedWallet.id).toBe(USER_WALLET_ID);
        expect(savedWallet.ownerId).toBe("owner-2");
      });
    });
  });

  // ── Duplicate owner ────────────────────────────────────────────

  describe("Given a wallet already exists for the same owner/platform/currency", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(true);
    });

    describe("When a wallet creation is attempted", () => {
      it("Then it throws WALLET_ALREADY_EXISTS", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, CURRENCY);

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_ALREADY_EXISTS",
          kind: ErrorKind.Conflict,
        });
      });
    });
  });

  // ── Currency uppercased ────────────────────────────────────────

  describe("Given a valid owner with no existing wallet", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID, SYSTEM_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      walletRepo.findSystemWallet.mockResolvedValue(null);
    });

    describe("When a wallet is created with lowercase currency 'usd'", () => {
      it("Then the saved wallet has uppercased currency 'USD'", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, "usd");

        await useCase.handle(ctx, cmd);

        // The user wallet (second save) should have uppercased currency
        const userWallet = walletRepo.save.mock.calls[1]![1] as Wallet;
        expect(userWallet.currencyCode).toBe("USD");

        // The system wallet (first save) should also have uppercased currency
        const sysWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(sysWallet.currencyCode).toBe("USD");
      });
    });
  });
});
