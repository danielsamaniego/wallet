import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetWalletUseCase } from "@/wallet/application/query/getWallet/usecase.js";
import { GetWalletQuery } from "@/wallet/application/query/getWallet/query.js";
import type { WalletDTO } from "@/wallet/application/query/getWallet/query.js";
import type { IWalletReadStore } from "@/wallet/application/ports/wallet.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Shared fixtures ────────────────────────────────────────────────

const WALLET_ID = "wallet-1";
const PLATFORM_ID = "platform-1";

const walletDTO: WalletDTO = {
  id: WALLET_ID,
  owner_id: "owner-1",
  platform_id: PLATFORM_ID,
  currency_code: "USD",
  balance_cents: 10000,
  available_balance_cents: 8000,
  status: "ACTIVE",
  is_system: false,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("GetWalletUseCase", () => {
  const readStore = mock<IWalletReadStore>();
  const logger = createMockLogger();
  const useCase = new GetWalletUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Wallet found ──────────────────────────────────────────────

  describe("Given a wallet exists in the read store", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(walletDTO);
    });

    describe("When the wallet is queried by id", () => {
      it("Then it returns the wallet DTO", async () => {
        const query = new GetWalletQuery(WALLET_ID, PLATFORM_ID);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(walletDTO);
        expect(readStore.getById).toHaveBeenCalledWith(ctx, WALLET_ID, PLATFORM_ID);
      });
    });
  });

  // ── Wallet not found ──────────────────────────────────────────

  describe("Given no wallet exists for the given id", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(null);
    });

    describe("When the wallet is queried", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new GetWalletQuery(WALLET_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
