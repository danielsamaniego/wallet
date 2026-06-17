import { QueryParamsSchema } from "@/wallet/infrastructure/adapters/inbound/http/getTransactions/schemas.js";

// R1 — the `type` filter must include the multi-leg transaction types
// (charge, adjustment_credit, adjustment_debit) so settlement/fee/dispute/adjust
// legs are filterable, not just creatable/returnable.

describe("getTransactions QueryParamsSchema — type filter parity (R1)", () => {
  describe("Given the multi-leg transaction types", () => {
    describe("When filtering by type=charge", () => {
      it("Then it parses as an eq filter", () => {
        const result = QueryParamsSchema.safeParse({ "filter[type]": "charge" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([{ field: "type", operator: "eq", value: "charge" }]);
      });
    });

    describe("When filtering by type in [adjustment_credit, adjustment_debit]", () => {
      it("Then it parses as an in filter", () => {
        const result = QueryParamsSchema.safeParse({
          "filter[type]": "adjustment_credit,adjustment_debit",
        });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([
          { field: "type", operator: "in", value: ["adjustment_credit", "adjustment_debit"] },
        ]);
      });
    });
  });

  describe("Given a pre-existing transaction type", () => {
    describe("When filtering by type=deposit", () => {
      it("Then it still parses (no regression)", () => {
        const result = QueryParamsSchema.safeParse({ "filter[type]": "deposit" });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.filters).toEqual([{ field: "type", operator: "eq", value: "deposit" }]);
      });
    });
  });

  describe("Given an unsupported type value", () => {
    describe("When filtering by type=not_a_type", () => {
      it("Then parsing fails (the enum stays constrained)", () => {
        const result = QueryParamsSchema.safeParse({ "filter[type]": "not_a_type" });

        expect(result.success).toBe(false);
      });
    });
  });
});
