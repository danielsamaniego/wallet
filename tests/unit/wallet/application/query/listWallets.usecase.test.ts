import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ListWalletsUseCase } from "@/wallet/application/query/listWallets/usecase.js";
import { ListWalletsQuery } from "@/wallet/application/query/listWallets/query.js";
import type { PaginatedWallets } from "@/wallet/application/query/listWallets/query.js";
import type { WalletDTO } from "@/wallet/application/query/getWallet/query.js";
import type { IWalletReadStore } from "@/wallet/application/ports/wallet.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";

// ── Shared fixtures ────────────────────────────────────────────────

const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "createdAt", direction: "desc" }],
  limit: 20,
};

const walletA: WalletDTO = {
  id: "wallet-1",
  owner_id: "owner-1",
  platform_id: PLATFORM_ID,
  currency_code: "USD",
  balance_minor: 10000,
  available_balance_minor: 8000,
  status: "active",
  is_system: false,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

const walletB: WalletDTO = {
  id: "wallet-2",
  owner_id: "owner-2",
  platform_id: PLATFORM_ID,
  currency_code: "EUR",
  balance_minor: 5000,
  available_balance_minor: 5000,
  status: "active",
  is_system: false,
  created_at: 1700000001000,
  updated_at: 1700000001000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("ListWalletsUseCase", () => {
  const readStore = mock<IWalletReadStore>();
  const logger = createMockLogger();
  const useCase = new ListWalletsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Paginated results ─────────────────────────────────────────

  describe("Given wallets exist for the platform", () => {
    const paginatedResult: PaginatedWallets = {
      wallets: [walletA, walletB],
      next_cursor: "cursor-abc",
    };

    beforeEach(() => {
      readStore.list.mockResolvedValue(paginatedResult);
    });

    describe("When wallets are listed", () => {
      it("Then it returns the paginated wallets", async () => {
        const query = new ListWalletsQuery(PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginatedResult);
        expect(result.wallets).toHaveLength(2);
        expect(result.next_cursor).toBe("cursor-abc");
        expect(readStore.list).toHaveBeenCalledWith(ctx, PLATFORM_ID, listing);
      });
    });
  });

  // ── Empty results ─────────────────────────────────────────────

  describe("Given no wallets exist for the platform", () => {
    const emptyResult: PaginatedWallets = {
      wallets: [],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.list.mockResolvedValue(emptyResult);
    });

    describe("When wallets are listed", () => {
      it("Then it returns an empty wallets array with no cursor", async () => {
        const query = new ListWalletsQuery(PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.wallets).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  // ── Filters passed through ────────────────────────────────────

  describe("Given a listing query with owner_id filter", () => {
    const filteredResult: PaginatedWallets = {
      wallets: [walletA],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.list.mockResolvedValue(filteredResult);
    });

    describe("When wallets are listed with filters", () => {
      it("Then the filters are forwarded to the read store", async () => {
        const filteredListing: ListingQuery = {
          filters: [{ field: "ownerId", operator: "eq", value: "owner-1" }],
          sort: [{ field: "createdAt", direction: "desc" }],
          limit: 50,
        };
        const query = new ListWalletsQuery(PLATFORM_ID, filteredListing);

        const result = await useCase.handle(ctx, query);

        expect(result.wallets).toHaveLength(1);
        expect(readStore.list).toHaveBeenCalledWith(ctx, PLATFORM_ID, filteredListing);
      });
    });
  });
});
