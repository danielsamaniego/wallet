import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetWalletMovementsUseCase } from "@/wallet/application/query/getWalletMovements/usecase.js";
import { GetWalletMovementsQuery } from "@/wallet/application/query/getWalletMovements/query.js";
import type {
  PaginatedWalletMovements,
  WalletMovementDTO,
} from "@/wallet/application/query/getWalletMovements/query.js";
import type { IWalletMovementReadStore } from "@/wallet/application/ports/walletMovement.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const WALLET_ID = "wallet-1";
const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "created_at", direction: "desc" }],
  limit: 20,
};

const movement: WalletMovementDTO = {
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

describe("GetWalletMovementsUseCase", () => {
  const readStore = mock<IWalletMovementReadStore>();
  const logger = createMockLogger();
  const useCase = new GetWalletMovementsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given a wallet with movements in the read store", () => {
    const paginated: PaginatedWalletMovements = {
      movements: [movement],
      next_cursor: "cursor-xyz",
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(paginated);
    });

    describe("When movements are queried for the wallet", () => {
      it("Then it returns the paginated movements and delegates to the read store", async () => {
        const query = new GetWalletMovementsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginated);
        expect(result.movements).toHaveLength(1);
        expect(result.next_cursor).toBe("cursor-xyz");
        expect(readStore.getByWallet).toHaveBeenCalledWith(
          ctx,
          WALLET_ID,
          PLATFORM_ID,
          listing,
          undefined,
        );
      });
    });
  });

  describe("Given a wallet exists but has no movements", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue({ movements: [], next_cursor: null });
    });

    describe("When movements are queried for the wallet", () => {
      it("Then it returns an empty movements array with no cursor", async () => {
        const query = new GetWalletMovementsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.movements).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(null);
    });

    describe("When movements are queried for a non-existent wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new GetWalletMovementsQuery(WALLET_ID, PLATFORM_ID, listing);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });

  describe("Given a free-text query", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue({ movements: [], next_cursor: null });
    });

    describe("When movements are queried with q", () => {
      it("Then it forwards q to the read store", async () => {
        const query = new GetWalletMovementsQuery(WALLET_ID, PLATFORM_ID, listing, "INV-1");

        await useCase.handle(ctx, query);

        expect(readStore.getByWallet).toHaveBeenCalledWith(
          ctx,
          WALLET_ID,
          PLATFORM_ID,
          listing,
          "INV-1",
        );
      });
    });
  });
});
