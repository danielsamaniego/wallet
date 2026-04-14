import { buildPrismaListing } from "@/utils/infrastructure/listing.prisma.js";
import { encodeCursor } from "@/utils/kernel/listing.js";
import type { FilterCondition, JsonFilterCondition, SortField } from "@/utils/kernel/listing.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("buildPrismaListing", () => {
  const baseWhere = { platformId: "plat-1" };

  // ── No filters, no cursor ──────────────────────────────────────

  describe("Given no filters, no cursor, and default sort", () => {
    describe("When buildPrismaListing is called", () => {
      it("Then it returns baseWhere as-is, orderBy with tiebreaker, and take = limit+1", () => {
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, [], sort, 20);

        expect(result.where).toEqual({ platformId: "plat-1" });
        expect(result.orderBy).toEqual([
          { createdAt: "desc" },
          { id: "desc" },
        ]);
        expect(result.take).toBe(21);
      });
    });
  });

  // ── Sort already has id (no extra tiebreaker) ──────────────────

  describe("Given sort already includes id", () => {
    describe("When buildPrismaListing is called", () => {
      it("Then it does not add a duplicate id tiebreaker", () => {
        const sort: SortField[] = [
          { field: "createdAt", direction: "desc" },
          { field: "id", direction: "asc" },
        ];

        const result = buildPrismaListing(baseWhere, [], sort, 10);

        expect(result.orderBy).toEqual([
          { createdAt: "desc" },
          { id: "asc" },
        ]);
        expect(result.take).toBe(11);
      });
    });
  });

  // ── Filters (eq, gt, gte, lt, lte, in) ────────────────────────

  describe("Given filters with various operators", () => {
    describe("When filters use eq operator", () => {
      it("Then WHERE uses AND with direct value", () => {
        const filters: FilterCondition[] = [
          { field: "status", operator: "eq", value: "active" },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { status: "active" },
          ],
        });
      });
    });

    describe("When filters use gt operator", () => {
      it("Then WHERE contains { gt: value }", () => {
        const filters: FilterCondition[] = [
          { field: "amount", operator: "gt", value: 100 },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { amount: { gt: 100 } },
          ],
        });
      });
    });

    describe("When filters use gte operator", () => {
      it("Then WHERE contains { gte: value }", () => {
        const filters: FilterCondition[] = [
          { field: "amount", operator: "gte", value: 50 },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { amount: { gte: 50 } },
          ],
        });
      });
    });

    describe("When filters use lt operator", () => {
      it("Then WHERE contains { lt: value }", () => {
        const filters: FilterCondition[] = [
          { field: "amount", operator: "lt", value: 200 },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { amount: { lt: 200 } },
          ],
        });
      });
    });

    describe("When filters use lte operator", () => {
      it("Then WHERE contains { lte: value }", () => {
        const filters: FilterCondition[] = [
          { field: "amount", operator: "lte", value: 999 },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { amount: { lte: 999 } },
          ],
        });
      });
    });

    describe("When filters use in operator", () => {
      it("Then WHERE contains { in: [...] }", () => {
        const filters: FilterCondition[] = [
          { field: "status", operator: "in", value: ["active", "closed"] },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { status: { in: ["active", "closed"] } },
          ],
        });
      });
    });

    describe("When multiple filters are provided", () => {
      it("Then all filter conditions appear in the AND array", () => {
        const filters: FilterCondition[] = [
          { field: "status", operator: "eq", value: "active" },
          { field: "amount", operator: "gt", value: 100 },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { status: "active" },
            { amount: { gt: 100 } },
          ],
        });
      });
    });
  });

  // ── JSON filters ───────────────────────────────────────────────

  describe("Given JSON path filters", () => {
    describe("When a jsonFilter is provided", () => {
      it("Then WHERE includes a path+equals condition in the AND array", () => {
        const jsonFilters: JsonFilterCondition[] = [
          { field: "metadata", path: ["source"], value: "settlement" },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, [], sort, 10, undefined, jsonFilters);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { metadata: { path: ["source"], equals: "settlement" } },
          ],
        });
      });
    });

    describe("When both regular filters and jsonFilters are provided", () => {
      it("Then all conditions appear in the AND array", () => {
        const filters: FilterCondition[] = [
          { field: "status", operator: "eq", value: "active" },
        ];
        const jsonFilters: JsonFilterCondition[] = [
          { field: "metadata", path: ["type"], value: "internal" },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];

        const result = buildPrismaListing(baseWhere, filters, sort, 10, undefined, jsonFilters);

        expect(result.where).toEqual({
          AND: [
            { platformId: "plat-1" },
            { status: "active" },
            { metadata: { path: ["type"], equals: "internal" } },
          ],
        });
      });
    });
  });

  // ── Cursor-based pagination (keyset) ───────────────────────────

  describe("Given a valid cursor", () => {
    describe("When sorting desc by createdAt and cursor is provided", () => {
      it("Then WHERE includes keyset OR conditions for pagination", () => {
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
        const cursor = encodeCursor(sort, { createdAt: 1700000000000, id: "last-id" });

        const result = buildPrismaListing(baseWhere, [], sort, 10, cursor);

        // Should have AND with baseWhere + OR keyset clause
        expect(result.where).toHaveProperty("AND");
        const andArray = (result.where as Record<string, unknown>).AND as unknown[];
        expect(andArray[0]).toEqual({ platformId: "plat-1" });

        // Last element is the keyset where with OR clauses
        const keysetClause = andArray[andArray.length - 1] as Record<string, unknown>;
        expect(keysetClause).toHaveProperty("OR");
        const orClauses = keysetClause.OR as Record<string, unknown>[];
        // For 2 sort fields (createdAt desc + id desc tiebreaker):
        //   (createdAt < value) OR (createdAt = value AND id < lastId)
        expect(orClauses.length).toBe(2);
        expect(orClauses[0]).toEqual({ createdAt: { lt: 1700000000000 } });
        expect(orClauses[1]).toEqual({
          createdAt: 1700000000000,
          id: { lt: "last-id" },
        });
      });
    });

    describe("When sorting asc by a field and cursor is provided", () => {
      it("Then keyset uses gt comparator", () => {
        const sort: SortField[] = [{ field: "createdAt", direction: "asc" }];
        const cursor = encodeCursor(sort, { createdAt: 1000, id: "abc" });

        const result = buildPrismaListing(baseWhere, [], sort, 10, cursor);

        const andArray = (result.where as Record<string, unknown>).AND as unknown[];
        const keysetClause = andArray[andArray.length - 1] as Record<string, unknown>;
        const orClauses = keysetClause.OR as Record<string, unknown>[];

        expect(orClauses[0]).toEqual({ createdAt: { gt: 1000 } });
        expect(orClauses[1]).toEqual({
          createdAt: 1000,
          id: { gt: "abc" },
        });
      });
    });

    describe("When cursor is used together with filters", () => {
      it("Then AND array contains baseWhere, filter conditions, and keyset clause", () => {
        const filters: FilterCondition[] = [
          { field: "status", operator: "eq", value: "active" },
        ];
        const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
        const cursor = encodeCursor(sort, { createdAt: 1700000000000, id: "xyz" });

        const result = buildPrismaListing(baseWhere, filters, sort, 20, cursor);

        const andArray = (result.where as Record<string, unknown>).AND as unknown[];
        expect(andArray.length).toBe(3); // baseWhere + filter + keyset
        expect(andArray[0]).toEqual({ platformId: "plat-1" });
        expect(andArray[1]).toEqual({ status: "active" });
        // Third is the keyset OR clause
        expect(andArray[2]).toHaveProperty("OR");
      });
    });
  });
});
