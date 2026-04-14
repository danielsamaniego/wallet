import { describe, it, expect } from "vitest";
import { toSafeNumber, toNumber, bigIntReplacer } from "@/utils/kernel/bigint.js";

describe("bigint utilities", () => {
  // ── toSafeNumber ─────────────────────────────────────────────────────

  describe("toSafeNumber", () => {
    it("Given a bigint within safe range, When called, Then returns a number", () => {
      expect(toSafeNumber(42n)).toBe(42);
    });

    it("Given zero, When called, Then returns 0", () => {
      expect(toSafeNumber(0n)).toBe(0);
    });

    it("Given a negative bigint within safe range, When called, Then returns a number", () => {
      expect(toSafeNumber(-100n)).toBe(-100);
    });

    it("Given MAX_SAFE_INTEGER as bigint, When called, Then returns a number", () => {
      expect(toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("Given MIN_SAFE_INTEGER as bigint, When called, Then returns a number", () => {
      expect(toSafeNumber(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
    });

    it("Given a bigint exceeding MAX_SAFE_INTEGER, When called, Then returns a string", () => {
      const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      const result = toSafeNumber(big);
      expect(typeof result).toBe("string");
      expect(result).toBe(big.toString());
    });

    it("Given a bigint below MIN_SAFE_INTEGER, When called, Then returns a string", () => {
      const small = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
      const result = toSafeNumber(small);
      expect(typeof result).toBe("string");
      expect(result).toBe(small.toString());
    });
  });

  // ── toNumber ─────────────────────────────────────────────────────────

  describe("toNumber", () => {
    it("Given a bigint, When called, Then returns the numeric value", () => {
      expect(toNumber(123n)).toBe(123);
    });

    it("Given zero bigint, When called, Then returns 0", () => {
      expect(toNumber(0n)).toBe(0);
    });

    it("Given a negative bigint, When called, Then returns the negative number", () => {
      expect(toNumber(-999n)).toBe(-999);
    });
  });

  // ── bigIntReplacer ───────────────────────────────────────────────────

  describe("bigIntReplacer", () => {
    it("Given a safe bigint value, When used as replacer, Then converts to number", () => {
      expect(bigIntReplacer("key", 42n)).toBe(42);
    });

    it("Given a bigint exceeding MAX_SAFE_INTEGER, When used as replacer, Then converts to string", () => {
      const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(bigIntReplacer("key", big)).toBe(big.toString());
    });

    it("Given a bigint below MIN_SAFE_INTEGER, When used as replacer, Then converts to string", () => {
      const small = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
      expect(bigIntReplacer("key", small)).toBe(small.toString());
    });

    it("Given a non-bigint value, When used as replacer, Then returns it unchanged", () => {
      expect(bigIntReplacer("key", "hello")).toBe("hello");
      expect(bigIntReplacer("key", 42)).toBe(42);
      expect(bigIntReplacer("key", null)).toBe(null);
      expect(bigIntReplacer("key", true)).toBe(true);
    });

    it("Given an object with bigint fields, When JSON.stringify uses replacer, Then serializes correctly", () => {
      const obj = {
        small: 100n,
        large: BigInt(Number.MAX_SAFE_INTEGER) + 10n,
        normal: "text",
      };
      const result = JSON.parse(JSON.stringify(obj, bigIntReplacer));
      expect(result.small).toBe(100);
      expect(result.large).toBe((BigInt(Number.MAX_SAFE_INTEGER) + 10n).toString());
      expect(result.normal).toBe("text");
    });
  });
});
