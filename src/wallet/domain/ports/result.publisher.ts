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
  /**
   * Human-readable reason (the AppError's `msg` when the worker caught
   * an `AppError`, otherwise `Error.message` or the stringified value).
   * Only populated when `status === "failed"`. Mirrored on
   * `Movement.failed_reason`.
   */
  failedReason?: string | null;
  /**
   * Original `AppError.kind` string when the worker caught an AppError
   * (`NOT_FOUND`, `DOMAIN_RULE`, `CONFLICT`, etc.) so the awaiting HTTP
   * handler can rebuild the precise error and the global onError maps
   * it to the same status the sync path would have returned (404 vs
   * 422 vs 409 etc.). Absent when the worker caught a non-AppError
   * (handler falls back to a generic 422 in that case).
   */
  failedKind?: string;
  /**
   * Original `AppError.code` string (e.g. `WALLET_NOT_FOUND`,
   * `INSUFFICIENT_FUNDS`). Always paired with `failedKind`.
   */
  failedCode?: string;
  /**
   * Operation result body captured from the matching service (e.g.
   * `DepositResult`, `TransferResult`). Only populated when
   * `status === "posted"` — failures carry `failedReason`/`failedKind`/
   * `failedCode` instead. Loose `Record<string, unknown>` so the
   * publisher does not need to know about every operation result type;
   * the HTTP handler that dispatched the enqueue casts to its expected
   * shape.
   *
   * The contract is "what the sync use case would have returned" so an
   * async handler can build the same response body as the sync path —
   * the API stays uniform across both modes.
   */
  body?: Record<string, unknown>;
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
