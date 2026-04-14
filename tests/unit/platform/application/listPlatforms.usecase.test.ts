import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { ListPlatformsUseCase } from "@/platform/application/query/listPlatforms/usecase.js";
import { ListPlatformsQuery } from "@/platform/application/query/listPlatforms/query.js";
import type { IPlatformReadStore } from "@/platform/application/ports/platform.readstore.js";
import type { PaginatedPlatforms } from "@/platform/application/query/listPlatforms/query.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";

// ── Shared Fixtures ────────────────────────────────────────────────

const baseListing: ListingQuery = {
  filters: [],
  sort: [{ field: "createdAt", direction: "desc" }],
  limit: 20,
};

const listingWithCursorAndFilters: ListingQuery = {
  filters: [{ field: "status", operator: "eq", value: "active" }],
  sort: [{ field: "createdAt", direction: "desc" }],
  limit: 10,
  cursor: "some-cursor",
};

const sampleResult: PaginatedPlatforms = {
  platforms: [
    { id: "plat-1", name: "Platform 1", status: "active", created_at: 1700000000000, updated_at: 1700000000000 },
    { id: "plat-2", name: "Platform 2", status: "active", created_at: 1700000001000, updated_at: 1700000001000 },
  ],
  next_cursor: "next-cursor-abc",
};

const emptyResult: PaginatedPlatforms = {
  platforms: [],
  next_cursor: null,
};

// ── Tests ──────────────────────────────────────────────────────────

describe("ListPlatformsUseCase", () => {
  const readStore = mock<IPlatformReadStore>();
  const logger: ILogger = createMockLogger();
  const useCase = new ListPlatformsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
    vi.mocked(logger.debug).mockClear();
    vi.mocked(logger.info).mockClear();
  });

  // ── Successful listing with results ────────────────────────────

  describe("Given the read store returns platforms", () => {
    beforeEach(() => {
      readStore.list.mockResolvedValue(sampleResult);
    });

    describe("When the query is handled", () => {
      it("Then it returns the paginated platforms from the read store", async () => {
        const query = new ListPlatformsQuery(baseListing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(sampleResult);
        expect(readStore.list).toHaveBeenCalledWith(ctx, baseListing);
      });

      it("Then it logs debug at start and info on success", async () => {
        const query = new ListPlatformsQuery(baseListing);

        await useCase.handle(ctx, query);

        expect(logger.debug).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("start"),
          expect.objectContaining({
            limit: 20,
            cursor: null,
            filters_count: 0,
            sort: ["createdAt:desc"],
          }),
        );

        expect(logger.info).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("success"),
          expect.objectContaining({
            platforms_count: 2,
            has_more: true,
          }),
        );
      });
    });
  });

  // ── Empty result ───────────────────────────────────────────────

  describe("Given the read store returns no platforms", () => {
    beforeEach(() => {
      readStore.list.mockResolvedValue(emptyResult);
    });

    describe("When the query is handled", () => {
      it("Then it returns empty platforms with null cursor", async () => {
        const query = new ListPlatformsQuery(baseListing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(emptyResult);
      });

      it("Then it logs has_more as false", async () => {
        const query = new ListPlatformsQuery(baseListing);

        await useCase.handle(ctx, query);

        expect(logger.info).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("success"),
          expect.objectContaining({
            platforms_count: 0,
            has_more: false,
          }),
        );
      });
    });
  });

  // ── Listing with cursor and filters ────────────────────────────

  describe("Given a listing query with cursor and filters", () => {
    beforeEach(() => {
      readStore.list.mockResolvedValue(sampleResult);
    });

    describe("When the query is handled", () => {
      it("Then it passes cursor and filters to the read store", async () => {
        const query = new ListPlatformsQuery(listingWithCursorAndFilters);

        await useCase.handle(ctx, query);

        expect(readStore.list).toHaveBeenCalledWith(ctx, listingWithCursorAndFilters);
      });

      it("Then debug log includes cursor and filters_count", async () => {
        const query = new ListPlatformsQuery(listingWithCursorAndFilters);

        await useCase.handle(ctx, query);

        expect(logger.debug).toHaveBeenCalledWith(
          ctx,
          expect.stringContaining("start"),
          expect.objectContaining({
            limit: 10,
            cursor: "some-cursor",
            filters_count: 1,
          }),
        );
      });
    });
  });
});
