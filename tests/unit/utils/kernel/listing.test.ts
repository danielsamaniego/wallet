import { describe, it, expect } from "vitest";
import {
  sortSignature,
  ensureTiebreaker,
  encodeCursor,
  decodeCursor,
} from "@/utils/kernel/listing.js";
import type { SortField } from "@/utils/kernel/listing.js";

describe("listing utilities", () => {
  // ── sortSignature ────────────────────────────────────────────────────

  describe("sortSignature", () => {
    it("Given a single sort field, When called, Then returns a base64 signature truncated to 12 chars", () => {
      const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
      const sig = sortSignature(sort);
      expect(typeof sig).toBe("string");
      expect(sig.length).toBeLessThanOrEqual(12);
    });

    it("Given multiple sort fields, When called, Then returns a deterministic signature", () => {
      const sort: SortField[] = [
        { field: "name", direction: "asc" },
        { field: "id", direction: "desc" },
      ];
      const sig1 = sortSignature(sort);
      const sig2 = sortSignature(sort);
      expect(sig1).toBe(sig2);
    });

    it("Given different sort orders, When called, Then returns different signatures", () => {
      const sortA: SortField[] = [{ field: "name", direction: "asc" }];
      const sortB: SortField[] = [{ field: "name", direction: "desc" }];
      expect(sortSignature(sortA)).not.toBe(sortSignature(sortB));
    });
  });

  // ── ensureTiebreaker ─────────────────────────────────────────────────

  describe("ensureTiebreaker", () => {
    it("Given sort without id field, When called, Then appends id with direction of last field", () => {
      const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
      const result = ensureTiebreaker(sort);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ field: "id", direction: "desc" });
    });

    it("Given sort already containing id, When called, Then does not duplicate id", () => {
      const sort: SortField[] = [
        { field: "createdAt", direction: "asc" },
        { field: "id", direction: "asc" },
      ];
      const result = ensureTiebreaker(sort);
      expect(result).toHaveLength(2);
    });

    it("Given an empty sort array, When called, Then appends id with desc direction", () => {
      const result = ensureTiebreaker([]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ field: "id", direction: "desc" });
    });

    it("Given multiple fields with ascending last, When called, Then id uses asc", () => {
      const sort: SortField[] = [
        { field: "name", direction: "desc" },
        { field: "createdAt", direction: "asc" },
      ];
      const result = ensureTiebreaker(sort);
      expect(result[2]).toEqual({ field: "id", direction: "asc" });
    });
  });

  // ── encodeCursor / decodeCursor ──────────────────────────────────────

  describe("encodeCursor", () => {
    it("Given sort and lastRow, When encoded, Then returns a non-empty base64url string", () => {
      const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
      const lastRow = { createdAt: 1700000000, id: "abc-123" };
      const cursor = encodeCursor(sort, lastRow);
      expect(typeof cursor).toBe("string");
      expect(cursor.length).toBeGreaterThan(0);
    });

    it("Given a row with bigint value, When encoded, Then serializes bigint as string in payload", () => {
      const sort: SortField[] = [{ field: "balance", direction: "desc" }];
      const lastRow = { balance: 9007199254740993n, id: "xyz" };
      const cursor = encodeCursor(sort, lastRow);
      // Decode to verify bigint was serialized as string
      const json = Buffer.from(cursor, "base64url").toString("utf-8");
      const payload = JSON.parse(json);
      expect(payload.v[0]).toBe("9007199254740993");
    });
  });

  describe("decodeCursor", () => {
    it("Given a valid cursor, When decoded with matching sort, Then returns values array", () => {
      const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
      const lastRow = { createdAt: 1700000000, id: "abc-123" };
      const cursor = encodeCursor(sort, lastRow);

      const values = decodeCursor(cursor, sort);
      expect(values).toEqual([1700000000, "abc-123"]);
    });

    it("Given a valid cursor, When decoded with different sort order, Then throws CURSOR_SORT_MISMATCH", () => {
      const sort: SortField[] = [{ field: "createdAt", direction: "desc" }];
      const lastRow = { createdAt: 1700000000, id: "abc-123" };
      const cursor = encodeCursor(sort, lastRow);

      const differentSort: SortField[] = [{ field: "name", direction: "asc" }];
      expect(() => decodeCursor(cursor, differentSort)).toThrow("CURSOR_SORT_MISMATCH");
    });

    it("Given a corrupted cursor string, When decoded, Then throws INVALID_CURSOR", () => {
      expect(() => decodeCursor("not-valid-base64!", [{ field: "id", direction: "desc" }])).toThrow(
        "INVALID_CURSOR",
      );
    });

    it("Given a cursor with invalid JSON, When decoded, Then throws INVALID_CURSOR", () => {
      const broken = Buffer.from("this is not json").toString("base64url");
      expect(() => decodeCursor(broken, [{ field: "id", direction: "desc" }])).toThrow(
        "INVALID_CURSOR",
      );
    });
  });
});
