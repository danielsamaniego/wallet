import type { AppContext } from "../../../utils/kernel/context.js";

/**
 * Payload published to the movement-processing queue. The body is intentionally
 * minimal: only the `movement_id` travels — the worker re-loads the persisted
 * movement (and its idempotency record) by id, so the source of truth stays in
 * Postgres and the queue payload never drifts out of sync.
 *
 * `idempotency_key` is optional metadata used by the queue infrastructure
 * (e.g. QStash `deduplicationId`) to drop accidentally-duplicated publishes
 * at the queue layer, *before* a worker is even invoked. It is not a
 * replacement for the application-level idempotency record — the worker
 * re-checks the movement's lifecycle status before acting.
 */
export interface MovementQueueMessage {
  movementId: string;
  idempotencyKey?: string;
}

/**
 * Outbound port that the enqueueing use case (Phase 2 `EnqueueMovementUseCase`)
 * uses to schedule a movement for asynchronous processing. The adapter (Phase 2
 * `QStashMovementQueuePublisher`) translates `publish` into a real
 * `qstash.queueClient.enqueueJSON({ ... })` call against the configured queue,
 * which then delivers a signed POST to `/internal/worker/process-movement` with
 * the throttle (`parallelism`) configured on the queue.
 *
 * The contract is fire-and-forget at the queue level: success means the queue
 * has accepted custody, *not* that the worker has run. Use-case callers must
 * have already persisted the movement in `status = "pending"` before publish so
 * a delivered message always has a corresponding row to act on.
 */
export interface IMovementQueuePublisher {
  publish(ctx: AppContext, message: MovementQueueMessage): Promise<void>;
}
