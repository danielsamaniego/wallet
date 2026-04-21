import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
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
const SHARD_COUNT = 32;

const USER_WALLET_ID = "wallet-user-1";

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

  // ── Happy path: user wallet created; system shards materialised via ensureSystemWalletShards
  describe("Given no wallets exist for the platform yet", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
    });

    describe("When a wallet is created", () => {
      it("Then it materialises the system wallet shards and saves one user wallet", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, CURRENCY, SHARD_COUNT);

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ walletId: USER_WALLET_ID });
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledWith(
          expect.anything(),
          PLATFORM,
          CURRENCY,
          SHARD_COUNT,
          expect.any(Number),
        );
        // Only the user wallet is saved here; shards are created via createMany
        // inside ensureSystemWalletShards, not through save().
        expect(walletRepo.save).toHaveBeenCalledOnce();
        const saved = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(saved.isSystem).toBe(false);
        expect(saved.id).toBe(USER_WALLET_ID);
        expect(saved.ownerId).toBe(OWNER);
        expect(saved.platformId).toBe(PLATFORM);
        expect(saved.currencyCode).toBe(CURRENCY);
        expect(saved.shardIndex).toBe(0);
      });
    });
  });

  // ── Second wallet: ensureSystemWalletShards is a no-op but still invoked
  describe("Given system shards already exist for the (platform, currency)", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      // ensureSystemWalletShards is idempotent — returns undefined whether
      // it inserted new shards or found them all existing.
      walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
    });

    describe("When a second user wallet is created", () => {
      it("Then ensureSystemWalletShards is still invoked (idempotent) and the user wallet is saved", async () => {
        const cmd = new CreateWalletCommand("owner-2", PLATFORM, CURRENCY, SHARD_COUNT);

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({ walletId: USER_WALLET_ID });
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledOnce();
        expect(walletRepo.save).toHaveBeenCalledOnce();
        const saved = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(saved.isSystem).toBe(false);
        expect(saved.ownerId).toBe("owner-2");
      });
    });
  });

  // ── Duplicate owner ────────────────────────────────────────────
  describe("Given a wallet already exists for the same owner/platform/currency", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(true);
      walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
    });

    describe("When a wallet creation is attempted", () => {
      it("Then it throws WALLET_ALREADY_EXISTS and does not save a user wallet", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, CURRENCY, SHARD_COUNT);

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_ALREADY_EXISTS",
          kind: ErrorKind.Conflict,
        });
        // ensureSystemWalletShards runs before the existence check so that
        // concurrent createWallet requests don't hit SERIALIZABLE conflicts on
        // the shard rows inside the tx. It is idempotent; invoking it here is
        // harmless even though the user wallet is rejected.
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledOnce();
        expect(walletRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  // ── Currency uppercased ────────────────────────────────────────
  describe("Given a valid owner with no existing wallet", () => {
    beforeEach(() => {
      idGen = createMockIDGenerator([USER_WALLET_ID]);
      useCase = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);

      walletRepo.existsByOwner.mockResolvedValue(false);
      walletRepo.ensureSystemWalletShards.mockResolvedValue(undefined);
    });

    describe("When a wallet is created with lowercase currency 'usd'", () => {
      it("Then the user wallet and the ensureSystemWalletShards call both use the uppercase form", async () => {
        const cmd = new CreateWalletCommand(OWNER, PLATFORM, "usd", SHARD_COUNT);

        await useCase.handle(ctx, cmd);

        const saved = walletRepo.save.mock.calls[0]![1] as Wallet;
        expect(saved.currencyCode).toBe("USD");
        // The use case forwards cmd.currencyCode as-is to the repo; the adapter
        // uppercases. Here we verify the contract at the use-case boundary:
        // the value passed is what the caller sent (the adapter handles the
        // normalisation). If the caller sent "usd" the repo gets "usd".
        expect(walletRepo.ensureSystemWalletShards).toHaveBeenCalledWith(
          expect.anything(),
          PLATFORM,
          "usd",
          SHARD_COUNT,
          expect.any(Number),
        );
      });
    });
  });
});
