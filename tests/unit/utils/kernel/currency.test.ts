import { describe, it, expect } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  getSupportedCurrencies,
} from "@/utils/kernel/currency.js";

describe("currency catalog", () => {
  // ── SUPPORTED_CURRENCIES ────────────────────────────────────────────

  describe("SUPPORTED_CURRENCIES", () => {
    it("Given the catalog, When accessed, Then it contains exactly USD, EUR, MXN, CLP, KWD", () => {
      const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
      expect(codes).toEqual(["USD", "EUR", "MXN", "CLP", "KWD"]);
    });

    it("Given the catalog, When accessed, Then each entry has code and minorUnit", () => {
      for (const entry of SUPPORTED_CURRENCIES) {
        expect(typeof entry.code).toBe("string");
        expect(typeof entry.minorUnit).toBe("number");
      }
    });

    it("Given the catalog, When accessed, Then minorUnit matches each currency's ISO 4217 exponent", () => {
      const expected: Record<string, number> = { USD: 2, EUR: 2, MXN: 2, CLP: 0, KWD: 3 };
      for (const entry of SUPPORTED_CURRENCIES) {
        expect(entry.minorUnit).toBe(expected[entry.code]);
      }
    });

    it("Given the catalog, When accessed, Then it is frozen (immutable)", () => {
      expect(Object.isFrozen(SUPPORTED_CURRENCIES)).toBe(true);
    });
  });

  // ── isSupportedCurrency ─────────────────────────────────────────────

  describe("isSupportedCurrency", () => {
    it("Given 'USD', When checked, Then returns true", () => {
      expect(isSupportedCurrency("USD")).toBe(true);
    });

    it("Given 'EUR', When checked, Then returns true", () => {
      expect(isSupportedCurrency("EUR")).toBe(true);
    });

    it("Given 'MXN', When checked, Then returns true", () => {
      expect(isSupportedCurrency("MXN")).toBe(true);
    });

    it("Given 'CLP', When checked, Then returns true", () => {
      expect(isSupportedCurrency("CLP")).toBe(true);
    });

    it("Given 'KWD', When checked, Then returns true", () => {
      expect(isSupportedCurrency("KWD")).toBe(true);
    });

    it("Given 'usd' (lowercase), When checked, Then returns false", () => {
      expect(isSupportedCurrency("usd")).toBe(false);
    });

    it("Given 'JPY' (valid ISO but unsupported), When checked, Then returns false", () => {
      expect(isSupportedCurrency("JPY")).toBe(false);
    });

    it("Given 'GBP' (valid ISO but unsupported), When checked, Then returns false", () => {
      expect(isSupportedCurrency("GBP")).toBe(false);
    });

    it("Given '' (empty), When checked, Then returns false", () => {
      expect(isSupportedCurrency("")).toBe(false);
    });

    it("Given 'USDX' (4 chars), When checked, Then returns false", () => {
      expect(isSupportedCurrency("USDX")).toBe(false);
    });

    it("Given '123' (numeric), When checked, Then returns false", () => {
      expect(isSupportedCurrency("123")).toBe(false);
    });
  });

  // ── getSupportedCurrencies ──────────────────────────────────────────

  describe("getSupportedCurrencies", () => {
    it("Given the catalog, When called, Then returns entries matching SUPPORTED_CURRENCIES", () => {
      const result = getSupportedCurrencies();
      expect(result).toEqual([...SUPPORTED_CURRENCIES]);
    });

    it("Given the catalog, When called, Then returns a new array (defensive copy)", () => {
      const a = getSupportedCurrencies();
      const b = getSupportedCurrencies();
      expect(a).not.toBe(b);
      expect(a).not.toBe(SUPPORTED_CURRENCIES);
    });
  });
});
