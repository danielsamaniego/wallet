import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ListHoldsUseCase } from "@/wallet/application/query/listHolds/usecase.js";
import { ListHoldsQuery } from "@/wallet/application/query/listHolds/query.js";
import type { PaginatedHolds } from "@/wallet/application/query/listHolds/query.js";
import type { HoldDTO } from "@/wallet/application/query/getHold/query.js";
import type { IHoldReadStore } from "@/wallet/application/ports/hold.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Shared fixtures ────────────────────────────────────────────────

const WALLET_ID = "wallet-1";
const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "created_at", direction: "desc" }],
  limit: 20,
};

const holdA: HoldDTO = {
  id: "hold-1",
  wallet_id: WALLET_ID,
  amount_cents: 5000,
  status: "ACTIVE",
  reference: "ref-001",
  expires_at: 1700100000000,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

const holdB: HoldDTO = {
  id: "hold-2",
  wallet_id: WALLET_ID,
  amount_cents: 3000,
  status: "CAPTURED",
  reference: null,
  expires_at: null,
  created_at: 1700000001000,
  updated_at: 1700000001000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("ListHoldsUseCase", () => {
  const readStore = mock<IHoldReadStore>();
  const logger = createMockLogger();
  const useCase = new ListHoldsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Paginated results ─────────────────────────────────────────

  describe("Given a wallet with holds in the read store", () => {
    const paginatedResult: PaginatedHolds = {
      holds: [holdA, holdB],
      next_cursor: "cursor-abc",
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(paginatedResult);
    });

    describe("When holds are listed for the wallet", () => {
      it("Then it returns the paginated holds", async () => {
        const query = new ListHoldsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginatedResult);
        expect(result.holds).toHaveLength(2);
        expect(result.next_cursor).toBe("cursor-abc");
        expect(readStore.getByWallet).toHaveBeenCalledWith(ctx, WALLET_ID, PLATFORM_ID, listing);
      });
    });
  });

  // ── Empty results ─────────────────────────────────────────────

  describe("Given a wallet exists but has no holds", () => {
    const emptyResult: PaginatedHolds = {
      holds: [],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(emptyResult);
    });

    describe("When holds are listed for the wallet", () => {
      it("Then it returns an empty holds array with no cursor", async () => {
        const query = new ListHoldsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.holds).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  // ── Wallet not found ──────────────────────────────────────────

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(null);
    });

    describe("When holds are listed for a non-existent wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new ListHoldsQuery(WALLET_ID, PLATFORM_ID, listing);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
