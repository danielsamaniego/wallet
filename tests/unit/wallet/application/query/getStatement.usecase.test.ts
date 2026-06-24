import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetStatementUseCase } from "@/wallet/application/query/getStatement/usecase.js";
import { GetStatementQuery } from "@/wallet/application/query/getStatement/query.js";
import type {
  PaginatedStatement,
  StatementEntryDTO,
} from "@/wallet/application/query/getStatement/query.js";
import type { IStatementReadStore } from "@/wallet/application/ports/statement.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const WALLET_ID = "wallet-1";
const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "created_at", direction: "desc" }],
  limit: 20,
};

const movement: StatementEntryDTO = {
  movement_id: "mv-1",
  transaction_id: "tx-1",
  type: "transfer_out",
  amount_minor: 5000,
  direction: "debit",
  reason: null,
  reference: "ref-001",
  metadata: { order_id: "order-1" },
  counterpart_wallet_id: "wallet-2",
  hold_id: null,
  status: "completed",
  balance_before_minor: 10000,
  balance_after_minor: 5000,
  created_at: 1700000000000,
};

describe("GetStatementUseCase", () => {
  const readStore = mock<IStatementReadStore>();
  const logger = createMockLogger();
  const useCase = new GetStatementUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given a wallet with entries in the read store", () => {
    const paginated: PaginatedStatement = {
      entries: [movement],
      next_cursor: "cursor-xyz",
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(paginated);
    });

    describe("When entries are queried for the wallet", () => {
      it("Then it returns the paginated entries and delegates to the read store", async () => {
        const query = new GetStatementQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginated);
        expect(result.entries).toHaveLength(1);
        expect(result.next_cursor).toBe("cursor-xyz");
        expect(readStore.getByWallet).toHaveBeenCalledWith(
          ctx,
          WALLET_ID,
          PLATFORM_ID,
          listing,
          undefined,
          undefined,
          undefined,
        );
      });
    });
  });

  describe("Given a wallet exists but has no entries", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue({ entries: [], next_cursor: null });
    });

    describe("When entries are queried for the wallet", () => {
      it("Then it returns an empty entries array with no cursor", async () => {
        const query = new GetStatementQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.entries).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(null);
    });

    describe("When entries are queried for a non-existent wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new GetStatementQuery(WALLET_ID, PLATFORM_ID, listing);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a free-text query", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue({ entries: [], next_cursor: null });
    });

    describe("When entries are queried with q", () => {
      it("Then it forwards q to the read store", async () => {
        const query = new GetStatementQuery(WALLET_ID, PLATFORM_ID, listing, "INV-1");

        await useCase.handle(ctx, query);

        expect(readStore.getByWallet).toHaveBeenCalledWith(
          ctx,
          WALLET_ID,
          PLATFORM_ID,
          listing,
          "INV-1",
          undefined,
          undefined,
        );
      });
    });
  });

  describe("Given a direction filter and total requested", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue({ entries: [], next_cursor: null, total: 7 });
    });

    describe("When entries are queried with direction and includeTotal", () => {
      it("Then it forwards direction and includeTotal and returns the total", async () => {
        const query = new GetStatementQuery(
          WALLET_ID,
          PLATFORM_ID,
          listing,
          undefined,
          "credit",
          true,
        );

        const result = await useCase.handle(ctx, query);

        expect(result.total).toBe(7);
        expect(readStore.getByWallet).toHaveBeenCalledWith(
          ctx,
          WALLET_ID,
          PLATFORM_ID,
          listing,
          undefined,
          "credit",
          true,
        );
      });
    });
  });
});
