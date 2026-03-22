import type { AppContext } from "../../../../utils/kernel/context.js";

export interface IdempotencyRecord {
  idempotencyKey: string;
  platformId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: number;
  expiresAt: number;
}

/**
 * IIdempotencyStore provides atomic operations for idempotency records.
 *
 * Implementations must guarantee:
 * - `acquire` is atomic: concurrent calls with the same key must result in
 *   exactly one returning `null` (winner) and others returning the existing record.
 *   Use INSERT ... ON CONFLICT or equivalent to prevent race conditions.
 * - `complete` updates the pending record with the actual response.
 */
export interface IIdempotencyStore {
  /**
   * Atomically attempt to acquire the idempotency key.
   * - Returns `null` if this caller won the race (key inserted as "pending").
   * - Returns the existing `IdempotencyRecord` if the key was already acquired
   *   (either pending or completed).
   */
  acquire(
    ctx: AppContext,
    idempotencyKey: string,
    platformId: string,
    requestHash: string,
    createdAt: number,
    expiresAt: number,
  ): Promise<IdempotencyRecord | null>;

  /**
   * Update a pending record with the actual response after handler execution.
   */
  complete(
    ctx: AppContext,
    idempotencyKey: string,
    platformId: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void>;

  /**
   * Delete a pending record so the idempotency key can be reused.
   * Called when the handler fails with a transient error (e.g. VERSION_CONFLICT, 5xx).
   */
  release(ctx: AppContext, idempotencyKey: string, platformId: string): Promise<void>;

  /** Delete all records past their expiresAt. Returns count of deleted rows. */
  deleteExpired(ctx: AppContext): Promise<number>;
}
