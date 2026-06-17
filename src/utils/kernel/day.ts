/** Milliseconds in a UTC day. */
export const DAY_MS = 86_400_000;

/** Start of the UTC day (00:00:00.000) containing `ms`, as Unix ms. */
export function startOfDayMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Inclusive count of UTC calendar days spanned by [fromMs, toMs]. */
export function dayCountInclusive(fromMs: number, toMs: number): number {
  return Math.floor(toMs / DAY_MS) - Math.floor(fromMs / DAY_MS) + 1;
}

/** Formats a Unix ms timestamp as a UTC date string (YYYY-MM-DD). */
export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
