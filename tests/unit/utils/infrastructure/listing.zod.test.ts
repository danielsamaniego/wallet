import { createListingQuerySchema } from "@/utils/infrastructure/listing.zod.js";
import type { ListingConfig } from "@/utils/kernel/listing.js";
import { encodeCursor } from "@/utils/kernel/listing.js";

// ── Shared Config Fixtures ─────────────────────────────────────────

const baseConfig: ListingConfig = {
  filterableFields: [
    { apiName: "status", prismaName: "status", type: "enum", operators: ["eq", "in"], enumValues: ["active", "closed"] },
    { apiName: "amount", prismaName: "amount", type: "number", operators: ["eq", "gt", "gte", "lt", "lte", "in"] },
    { apiName: "name", prismaName: "name", type: "string", operators: ["eq"] },
    { apiName: "created_at", prismaName: "createdAt", type: "date", operators: ["gt", "gte", "lt", "lte"] },
    { apiName: "sequence", prismaName: "sequence", type: "bigint", operators: ["eq", "gt"] },
  ],
  jsonFilterableFields: [
    { apiName: "metadata", prismaName: "metadata", maxDepth: 3 },
  ],
  sortableFields: [
    { apiName: "created_at", prismaName: "createdAt" },
    { apiName: "amount", prismaName: "amount" },
  ],
  defaultSort: [{ field: "createdAt", direction: "desc" }],
  maxLimit: 100,
  defaultLimit: 20,
};

function parse(input: Record<string, unknown>, config = baseConfig) {
  const schema = createListingQuerySchema(config);
  return schema.safeParse(input);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("createListingQuerySchema", () => {
  // ── Limit & Defaults ───────────────────────────────────────────

  describe("Given no query parameters", () => {
    describe("When the schema is parsed with an empty object", () => {
      it("Then it returns defaults (limit=20, default sort, no filters)", () => {
        const result = parse({});

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.limit).toBe(20);
        expect(result.data.sort).toEqual(baseConfig.defaultSort);
        expect(result.data.filters).toEqual([]);
        expect(result.data.cursor).toBeUndefined();
        expect(result.data.jsonFilters).toBeUndefined();
      });
    });
  });

  describe("Given a valid limit", () => {
    describe("When limit is within range", () => {
      it("Then it coerces the string to a number", () => {
        const result = parse({ limit: "50" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.limit).toBe(50);
      });
    });
  });

  describe("Given an invalid limit", () => {
    describe("When limit exceeds maxLimit", () => {
      it("Then parsing fails", () => {
        const result = parse({ limit: "200" });
        expect(result.success).toBe(false);
      });
    });

    describe("When limit is 0", () => {
      it("Then parsing fails", () => {
        const result = parse({ limit: "0" });
        expect(result.success).toBe(false);
      });
    });
  });

  // ── Sort ───────────────────────────────────────────────────────

  describe("Given a valid sort parameter", () => {
    describe("When sorting ascending by a single field", () => {
      it("Then it returns asc direction", () => {
        const result = parse({ sort: "created_at" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.sort).toEqual([{ field: "createdAt", direction: "asc" }]);
      });
    });

    describe("When sorting descending with - prefix", () => {
      it("Then it returns desc direction", () => {
        const result = parse({ sort: "-created_at" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
      });
    });

    describe("When sorting by multiple fields", () => {
      it("Then it returns multiple sort entries", () => {
        const result = parse({ sort: "-created_at,amount" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.sort).toEqual([
          { field: "createdAt", direction: "desc" },
          { field: "amount", direction: "asc" },
        ]);
      });
    });
  });

  describe("Given an invalid sort field", () => {
    describe("When the field is not in sortableFields", () => {
      it("Then parsing fails with an error", () => {
        const result = parse({ sort: "unknown_field" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("unknown sort field");
      });
    });
  });

  // ── Filter: shorthand eq ───────────────────────────────────────

  describe("Given a shorthand filter (eq)", () => {
    describe("When filter[status]=active is provided", () => {
      it("Then it produces an eq filter condition", () => {
        const result = parse({ "filter[status]": "active" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "status", operator: "eq", value: "active" },
        ]);
      });
    });
  });

  // ── Filter: shorthand implicit in (CSV) ────────────────────────

  describe("Given a CSV shorthand filter", () => {
    describe("When filter[status]=active,closed is provided", () => {
      it("Then it produces an implicit 'in' filter condition", () => {
        const result = parse({ "filter[status]": "active,closed" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "status", operator: "in", value: ["active", "closed"] },
        ]);
      });
    });
  });

  // ── Filter: explicit operator ──────────────────────────────────

  describe("Given explicit operator filters", () => {
    describe("When filter[amount][gt]=100 is provided", () => {
      it("Then it produces a gt filter with coerced number value", () => {
        const result = parse({ "filter[amount][gt]": "100" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "amount", operator: "gt", value: 100 },
        ]);
      });
    });

    describe("When multiple operators on the same field are provided", () => {
      it("Then it produces multiple filter conditions", () => {
        const result = parse({
          "filter[amount][gte]": "10",
          "filter[amount][lte]": "500",
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toContainEqual({ field: "amount", operator: "gte", value: 10 });
        expect(result.data.filters).toContainEqual({ field: "amount", operator: "lte", value: 500 });
      });
    });

    describe("When filter[amount][lt]=50 is provided", () => {
      it("Then it produces an lt filter", () => {
        const result = parse({ "filter[amount][lt]": "50" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "amount", operator: "lt", value: 50 },
        ]);
      });
    });

    describe("When filter[amount][eq]=42 is provided", () => {
      it("Then it produces an eq filter with number", () => {
        const result = parse({ "filter[amount][eq]": "42" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "amount", operator: "eq", value: 42 },
        ]);
      });
    });

    describe("When filter[amount][in]=1,2,3 is provided", () => {
      it("Then it produces an in filter with array of numbers", () => {
        const result = parse({ "filter[amount][in]": "1,2,3" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "amount", operator: "in", value: [1, 2, 3] },
        ]);
      });
    });
  });

  // ── Filter: string type ────────────────────────────────────────

  describe("Given a string-type filter", () => {
    describe("When filter[name]=hello is provided", () => {
      it("Then it returns the raw string value", () => {
        const result = parse({ "filter[name]": "hello" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "name", operator: "eq", value: "hello" },
        ]);
      });
    });
  });

  // ── Filter: number coercion error ──────────────────────────────

  describe("Given a number filter with non-numeric value", () => {
    describe("When filter[amount][gt]=abc is provided", () => {
      it("Then parsing fails", () => {
        const result = parse({ "filter[amount][gt]": "abc" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("expected a number");
      });
    });
  });

  // ── Filter: bigint type ────────────────────────────────────────

  describe("Given a bigint-type filter", () => {
    describe("When filter[sequence]=999 is provided", () => {
      it("Then it coerces the value to BigInt", () => {
        const result = parse({ "filter[sequence]": "999" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "sequence", operator: "eq", value: BigInt(999) },
        ]);
      });
    });

    describe("When filter[sequence]=not_a_number is provided", () => {
      it("Then parsing fails with bigint error", () => {
        const result = parse({ "filter[sequence]": "not_a_number" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("expected an integer");
      });
    });

    describe("When filter[sequence][gt]=42 is provided", () => {
      it("Then it produces a gt filter with BigInt", () => {
        const result = parse({ "filter[sequence][gt]": "42" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "sequence", operator: "gt", value: BigInt(42) },
        ]);
      });
    });
  });

  // ── Filter: date type ──────────────────────────────────────────

  describe("Given a date-type filter", () => {
    describe("When filter[created_at][gt] is a unix timestamp number string", () => {
      it("Then it coerces to BigInt from the number", () => {
        const result = parse({ "filter[created_at][gt]": "1700000000000" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "createdAt", operator: "gt", value: BigInt(1700000000000) },
        ]);
      });
    });

    describe("When filter[created_at][gt] is an ISO date string", () => {
      it("Then it parses the date and coerces to BigInt", () => {
        const result = parse({ "filter[created_at][gt]": "2024-01-01T00:00:00Z" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        const expected = BigInt(Date.parse("2024-01-01T00:00:00Z"));
        expect(result.data.filters).toEqual([
          { field: "createdAt", operator: "gt", value: expected },
        ]);
      });
    });

    describe("When filter[created_at][gt] is an unparseable string", () => {
      it("Then parsing fails with invalid date error", () => {
        const result = parse({ "filter[created_at][gt]": "not-a-date" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("invalid date");
      });
    });
  });

  // ── Filter: enum validation ────────────────────────────────────

  describe("Given an enum-type filter with enumValues constraint", () => {
    describe("When an invalid enum value is provided", () => {
      it("Then parsing fails", () => {
        const result = parse({ "filter[status]": "invalid_status" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("must be one of");
      });
    });

    describe("When a valid enum value is provided", () => {
      it("Then parsing succeeds", () => {
        const result = parse({ "filter[status]": "active" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "status", operator: "eq", value: "active" },
        ]);
      });
    });
  });

  // ── Unknown filter keys ────────────────────────────────────────

  describe("Given an unknown filter key", () => {
    describe("When filter[unknown_field]=value is provided", () => {
      it("Then parsing fails with unknown filter error", () => {
        const result = parse({ "filter[unknown_field]": "value" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("unknown filter parameter");
      });
    });
  });

  // ── Cursor validation ──────────────────────────────────────────

  describe("Given a valid cursor", () => {
    describe("When the cursor matches the sort signature", () => {
      it("Then parsing succeeds with the cursor included", () => {
        const sort = [{ field: "createdAt", direction: "desc" as const }];
        const validCursor = encodeCursor(sort, { createdAt: 1700000000000, id: "abc" });

        const result = parse({ cursor: validCursor });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.cursor).toBe(validCursor);
      });
    });
  });

  describe("Given an invalid cursor", () => {
    describe("When the cursor is garbage", () => {
      it("Then parsing fails", () => {
        const result = parse({ cursor: "not-a-valid-cursor" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.length).toBeGreaterThan(0);
      });
    });

    describe("When the cursor sort signature mismatches", () => {
      it("Then parsing fails with CURSOR_SORT_MISMATCH", () => {
        // Encode cursor with a different sort than the default
        const differentSort = [{ field: "amount", direction: "asc" as const }];
        const mismatchCursor = encodeCursor(differentSort, { amount: 100, id: "abc" });

        const result = parse({ cursor: mismatchCursor });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toBe("CURSOR_SORT_MISMATCH");
      });
    });
  });

  // ── JSON path filters ─────────────────────────────────────────

  describe("Given a JSON path filter", () => {
    describe("When filter[metadata.source]=settlement is provided", () => {
      it("Then it produces a jsonFilter condition", () => {
        const result = parse({ "filter[metadata.source]": "settlement" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.jsonFilters).toEqual([
          { field: "metadata", path: ["source"], value: "settlement" },
        ]);
      });
    });

    describe("When a nested JSON path filter[metadata.a.b]=val is provided", () => {
      it("Then it produces a jsonFilter with multi-segment path", () => {
        const result = parse({ "filter[metadata.a.b]": "val" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.jsonFilters).toEqual([
          { field: "metadata", path: ["a", "b"], value: "val" },
        ]);
      });
    });

    describe("When JSON path depth exceeds maxDepth", () => {
      it("Then parsing fails", () => {
        const result = parse({ "filter[metadata.a.b.c.d]": "val" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("path depth");
      });
    });

    describe("When JSON path segment has invalid characters", () => {
      it("Then parsing fails", () => {
        const result = parse({ "filter[metadata.a-b]": "val" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("invalid path segment");
      });
    });

    describe("When JSON filter value is empty string", () => {
      it("Then the filter is skipped (no jsonFilters produced)", () => {
        const result = parse({ "filter[metadata.source]": "" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.jsonFilters).toBeUndefined();
      });
    });
  });

  // ── Config without jsonFilterableFields ────────────────────────

  describe("Given a config without jsonFilterableFields", () => {
    const simpleConfig: ListingConfig = {
      filterableFields: [
        { apiName: "name", prismaName: "name", type: "string", operators: ["eq"] },
      ],
      sortableFields: [{ apiName: "name", prismaName: "name" }],
      defaultSort: [{ field: "name", direction: "asc" }],
      maxLimit: 50,
      defaultLimit: 10,
    };

    describe("When only standard filters are used", () => {
      it("Then parsing succeeds without jsonFilters", () => {
        const result = parse({ "filter[name]": "test" }, simpleConfig);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "name", operator: "eq", value: "test" },
        ]);
        expect(result.data.jsonFilters).toBeUndefined();
      });
    });

    describe("When an unknown filter[foo.bar]=baz is used", () => {
      it("Then parsing fails as unknown filter parameter", () => {
        const result = parse({ "filter[foo.bar]": "baz" }, simpleConfig);

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("unknown filter parameter");
      });
    });
  });

  // ── CSV shorthand with coercion error ──────────────────────────

  describe("Given a CSV shorthand filter on a number field", () => {
    describe("When one of the values is not a valid number", () => {
      it("Then parsing fails with a coercion error", () => {
        const result = parse({ "filter[amount]": "10,abc,30" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("expected a number");
      });
    });
  });

  // ── CSV shorthand on field without in operator ────────────────

  describe("Given a CSV shorthand on a field that only supports eq", () => {
    describe("When filter[name]=a,b is provided (name only supports eq)", () => {
      it("Then it uses eq operator with the raw CSV string value", () => {
        const result = parse({ "filter[name]": "a,b" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        // name is string type with only eq operator, so CSV is treated as literal eq value
        expect(result.data.filters).toEqual([
          { field: "name", operator: "eq", value: "a,b" },
        ]);
      });
    });
  });

  // ── Successful CSV shorthand in with number field ─────────────

  describe("Given a CSV shorthand filter on a number field with in operator", () => {
    describe("When filter[amount]=10,20,30 is provided", () => {
      it("Then it produces an implicit in filter with array of numbers", () => {
        const result = parse({ "filter[amount]": "10,20,30" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "amount", operator: "in", value: [10, 20, 30] },
        ]);
      });
    });
  });

  // ── JSON filter key where prefix does not match any json field ─

  describe("Given a config with jsonFilterableFields", () => {
    describe("When a filter key matches the JSON pattern but the prefix is not in jsonFilterableFields", () => {
      it("Then the key is treated as unknown filter parameter", () => {
        // baseConfig has jsonFilterableFields with prefix "metadata".
        // "filter[other.key]" matches the regex but "other" is not in the map.
        // However, since the filter key also doesn't match knownKeys, it falls
        // into the "unknown filter parameter" branch. But the isJsonFilterKey check
        // returns false because the prefix isn't in jsonPrefixes. So it's caught.
        const result = parse({ "filter[other.key]": "val" });

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues[0]!.message).toContain("unknown filter parameter");
      });
    });
  });

  // ── Shorthand filter on field without eq or in operator ─────────

  describe("Given a shorthand filter on a field that supports neither eq nor in", () => {
    const gtOnlyConfig: ListingConfig = {
      filterableFields: [
        { apiName: "score", prismaName: "score", type: "number", operators: ["gt"] },
      ],
      sortableFields: [],
      defaultSort: [{ field: "id", direction: "asc" }],
      maxLimit: 50,
      defaultLimit: 10,
    };

    describe("When filter[score]=42 is provided (no eq, no in)", () => {
      it("Then it is ignored (no filter condition produced)", () => {
        const result = parse({ "filter[score]": "42" }, gtOnlyConfig);

        expect(result.success).toBe(true);
        if (!result.success) return;
        // Shorthand falls through both conditions (no in, no eq) -- filter is skipped
        expect(result.data.filters).toEqual([]);
      });
    });
  });

  // ── Enum type without enumValues set ───────────────────────────

  describe("Given an enum filter without enumValues constraint", () => {
    const noEnumValuesConfig: ListingConfig = {
      filterableFields: [
        { apiName: "type", prismaName: "type", type: "enum", operators: ["eq"] },
      ],
      sortableFields: [],
      defaultSort: [{ field: "id", direction: "asc" }],
      maxLimit: 50,
      defaultLimit: 10,
    };

    describe("When any value is provided", () => {
      it("Then it passes through (no validation on allowed values)", () => {
        const result = parse({ "filter[type]": "anything" }, noEnumValuesConfig);

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "type", operator: "eq", value: "anything" },
        ]);
      });
    });
  });
});
