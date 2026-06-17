import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { SearchMovementsUseCase } from "@/wallet/application/query/searchMovements/usecase.js";
import { SearchMovementsQuery } from "@/wallet/application/query/searchMovements/query.js";
import type { PaginatedWalletMovements } from "@/wallet/application/query/getWalletMovements/query.js";
import type { IWalletMovementReadStore } from "@/wallet/application/ports/walletMovement.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";

const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "created_at", direction: "desc" }],
  limit: 20,
};

describe("SearchMovementsUseCase", () => {
  const readStore = mock<IWalletMovementReadStore>();
  const logger = createMockLogger();
  const useCase = new SearchMovementsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given matching movements across the platform", () => {
    const paginated: PaginatedWalletMovements = {
      movements: [],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.search.mockResolvedValue(paginated);
    });

    describe("When a search is dispatched with a query", () => {
      it("Then it delegates to the read store and returns the result", async () => {
        const query = new SearchMovementsQuery(PLATFORM_ID, "INV-1", listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toBe(paginated);
        expect(readStore.search).toHaveBeenCalledWith(ctx, PLATFORM_ID, "INV-1", listing);
      });
    });
  });
});
