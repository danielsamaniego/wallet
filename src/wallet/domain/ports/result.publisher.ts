import type { AppContext } from "../../../utils/kernel/context.js";

/**
 * Terminal lifecycle states the result publisher can announce. Mirrors the
 * subset of `MovementStatus` a waiting caller actually cares about: either
 * the business transaction committed (`posted`) or it gave up
 * (`failed`). Intermediate states (`pending`, `processing`) are never
 * published — they are deltas, not results.
 */
export type MovementResultStatus = "posted" | "failed";

export interface MovementResult {
  movementId: string;
  status: MovementResultStatus;
  /** Free-form code emitted only when `status === "failed"`. */
  failedReason?: string | null;
}

/**
 * Outbound port for the "sync illusion" path described in
 * HIGH_CONCURRENCY_PLAN.md. The Phase 2 worker calls `publish` after a
 * successful (or terminally failed) business transaction so that the original
 * HTTP handler — which has been awaiting on a per-movement channel via Redis
 * pub/sub — can wake up and respond `200 OK` to the consumer with the result.
 *
 * The contract is fire-and-forget and lossy by design: pub/sub does not
 * persist messages, so a handler that timed out before `publish` ran will
 * not be notified retroactively. That is intentional — those callers
 * already received `202 Accepted` and can poll `GET /v1/movements/{id}`
 * for the final state. The publisher does not need to retry or queue.
 *
 * Adapters are expected to additionally `SET` the result with a short TTL
 * (~60s) so a subscriber that started milliseconds after the publish can
 * still observe the result on its first read — closing the obvious race
 * between SUBSCRIBE and PUBLISH. Phase 2 ships this in the Redis adapter.
 */
export interface IResultPublisher {
  publish(ctx: AppContext, result: MovementResult): Promise<void>;
}
