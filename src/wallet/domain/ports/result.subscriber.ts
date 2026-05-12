import type { AppContext } from "../../../utils/kernel/context.js";
import type { MovementResult } from "./result.publisher.js";

export interface ResultSubscriberOptions {
  /** Maximum total time to wait for a result before resolving `null`. */
  timeoutMs: number;
  /** Interval between GET probes. Adapter-specific default when omitted. */
  pollMs?: number;
}

/**
 * Reader side of the async-processing "sync illusion" pattern. The HTTP
 * handler calls `waitFor(movementId, { timeoutMs })` right after
 * dispatching `EnqueueMovementCommand`. Resolves to:
 *
 *   - the published `MovementResult` (carrying the operation's sync-shape
 *     body for `posted` or the `failedReason` for `failed`) when the
 *     worker beats the wait window;
 *   - `null` when the timeout fires first — the handler then falls back
 *     to `202 Accepted` and the client polls `GET /v1/movements/{id}`.
 *
 * Implementations may use polling or SUBSCRIBE; both are valid as long
 * as they swallow transient backend errors so the caller observes a
 * benign timeout rather than a 5xx propagation.
 */
export interface IResultSubscriber {
  waitFor(
    ctx: AppContext,
    movementId: string,
    opts: ResultSubscriberOptions,
  ): Promise<MovementResult | null>;
}
