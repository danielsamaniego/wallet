import type { AppContext } from "../../../utils/kernel/context.js";
import type { Movement } from "../movement/movement.entity.js";

export interface IMovementRepository {
  /**
   * Append a freshly-created Movement to the journal. INSERT only — the
   * `movements_no_delete` + `movements_lifecycle_only_update` triggers in
   * `prisma/immutable_ledger.sql` reject DELETE and any UPDATE that touches
   * an immutable column.
   */
  save(ctx: AppContext, movement: Movement): Promise<void>;

  /**
   * Load a Movement by id, scoped to the requesting platform. Used by the
   * async worker (Phase 2B.4+) to discover a pending movement's `type` and
   * dispatch it to the right service. Returns `null` when the id does not
   * exist or belongs to another platform — same null semantics as the
   * read store, but Movements with NULL `platform_id` (pre-Phase-2B
   * legacy orphans) are intentionally NOT resolvable through this port:
   * the async worker should never operate on legacy orphans.
   */
  findById(ctx: AppContext, movementId: string, platformId: string): Promise<Movement | null>;

  /**
   * Atomic claim: transitions `pending → processing` if and only if the
   * row is currently `pending`. Returns the new Movement on success.
   * Returns `null` when the row is no longer `pending` (already claimed
   * by a concurrent worker, already posted, etc.) — the caller treats
   * this as "another worker won the race" and acks the queue message.
   */
  markProcessing(ctx: AppContext, movementId: string): Promise<Movement | null>;

  /**
   * Transitions `processing → posted`. Called by the worker after the
   * business transaction commits. Throws on unexpected state (row missing
   * or no longer `processing` — defensive, should not happen if
   * `markProcessing` succeeded earlier in the same transaction).
   */
  markPosted(ctx: AppContext, movementId: string): Promise<void>;

  /**
   * Transitions `processing → failed` and records the reason. Called by
   * the worker after exhausting retries (or on a non-retryable error).
   */
  markFailed(ctx: AppContext, movementId: string, reason: string): Promise<void>;
}
