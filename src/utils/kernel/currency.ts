/** Metadata for a supported currency. */
export interface CurrencyEntry {
  readonly code: string;
  readonly minorUnit: number;
}

/** Canonical catalog of currencies supported in phase 1. */
export const SUPPORTED_CURRENCIES: readonly CurrencyEntry[] = Object.freeze([
  { code: "USD", minorUnit: 2 },
  { code: "EUR", minorUnit: 2 },
  { code: "MXN", minorUnit: 2 },
  { code: "CLP", minorUnit: 0 },
  { code: "KWD", minorUnit: 3 },
]);

const supportedSet = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

/** Returns `true` when `code` is in the supported catalog (exact, case-sensitive). */
export function isSupportedCurrency(code: string): boolean {
  return supportedSet.has(code);
}

/** Returns a defensive copy of the supported-currency catalog. */
export function getSupportedCurrencies(): CurrencyEntry[] {
  return [...SUPPORTED_CURRENCIES];
}
