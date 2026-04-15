/**
 * BigInt serialization utilities for JSON responses.
 *
 * Prisma returns BigInt fields as native `bigint`, which throws
 * `TypeError: Do not know how to serialize a BigInt` on JSON.stringify().
 *
 * Strategy:
 * - Amounts (minor units) and timestamps (Unix ms) are converted to `number`
 *   when they fit safely within Number.MAX_SAFE_INTEGER (2^53 - 1).
 * - Values exceeding MAX_SAFE_INTEGER are serialized as strings to
 *   prevent precision loss (relevant for system wallet balances).
 * - API DTOs should use `number | string` for BigInt-sourced fields,
 *   or always `string` for maximum safety.
 *
 * Usage in adapters (read stores / HTTP handlers):
 *   import { toSafeNumber, bigIntReplacer } from "../utils/kernel/bigint.js";
 *   const dto = { balance_minor: toSafeNumber(wallet.cachedBalanceMinor) };
 */

/**
 * Converts a bigint to number if it fits within MAX_SAFE_INTEGER,
 * otherwise returns a string representation.
 */
export function toSafeNumber(value: bigint): number | string {
  if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

/**
 * Converts a bigint to number unconditionally.
 * Use only when you are certain the value fits within MAX_SAFE_INTEGER
 * (e.g., timestamps, small amounts).
 */
export function toNumber(value: bigint): number {
  return Number(value);
}

/**
 * JSON.stringify replacer that converts bigint values automatically.
 * Useful for quick serialization of Prisma results in adapters:
 *   JSON.stringify(prismaResult, bigIntReplacer)
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  return value;
}
