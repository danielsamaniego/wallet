import type { ICommandBus } from "../../../utils/application/cqrs.js";
import type { AppContext } from "../../../utils/kernel/context.js";
import type { MovementQueuePayload, MovementType } from "../../domain/movement/movement.entity.js";
import type { IResultSubscriber } from "../../domain/ports/result.subscriber.js";
import { EnqueueMovementCommand } from "../command/enqueueMovement/command.js";

/**
 * Result the HTTP handler observes after kicking off the async path.
 *
 *   - `completed` — the worker beat the wait window. `body` carries the
 *     same shape the sync `<op>Service.execute` would have returned, so
 *     the handler builds the same 200/201 JSON as today's sync path.
 *   - `failed`    — the worker reached the terminal `failed` state and
 *     published its reason. The handler should surface an error response.
 *   - `pending`   — the wait window expired before any terminal status
 *     was observed. The handler returns 202 Accepted with the
 *     `movement_id` so the client can poll `GET /v1/movements/{id}`.
 */
export type AsyncDispatchOutcome<TBody> =
  | { kind: "completed"; movementId: string; body: TBody }
  | { kind: "failed"; movementId: string; failedReason: string }
  | { kind: "pending"; movementId: string };

export interface AsyncDispatchInput {
  type: MovementType;
  platformId: string;
  idempotencyKey: string;
  queuePayload: MovementQueuePayload;
  reason?: string | null;
}

/**
 * Coordinates the inbound side of the "sync illusion" pattern: dispatch
 * `EnqueueMovementCommand` (which INSERTs a pending Movement and publishes
 * to QStash) then wait on the result subscriber up to `handlerWaitMs`.
 *
 * The helper does NOT decide whether the async path is eligible — the
 * caller checks `config.asyncProcessingEnabled` + presence of
 * `config.asyncPipeline` + `resultSubscriber`. When any of those is
 * missing the caller stays on today's synchronous dispatch.
 *
 * Errors from `commandBus.dispatch` propagate (the global onError maps
 * them). The published failed reason from the worker is returned as a
 * structured outcome rather than thrown — the handler decides how to
 * surface it to the client (since the original error kind/code is lost
 * across the queue, this commit returns a 422 with the reason; a future
 * iteration can extend the published payload to carry full error
 * fidelity).
 */
export async function asyncDispatch<TBody>(
  ctx: AppContext,
  commandBus: ICommandBus,
  resultSubscriber: IResultSubscriber,
  handlerWaitMs: number,
  input: AsyncDispatchInput,
): Promise<AsyncDispatchOutcome<TBody>> {
  const enqueueResult = await commandBus.dispatch(
    ctx,
    new EnqueueMovementCommand(
      input.type,
      input.platformId,
      input.idempotencyKey,
      input.queuePayload,
      input.reason ?? null,
    ),
  );
  const movementId = enqueueResult.movementId;

  const observed = await resultSubscriber.waitFor(ctx, movementId, {
    timeoutMs: handlerWaitMs,
  });

  if (observed === null) {
    return { kind: "pending", movementId };
  }

  if (observed.status === "failed") {
    return {
      kind: "failed",
      movementId,
      failedReason: observed.failedReason ?? "unknown",
    };
  }

  // `status === "posted"` — body should be present because the worker
  // captures the service return value. Defensive fallback: if absent
  // (e.g. a publisher from a future version we don't recognise), surface
  // an empty object — the handler will still build a minimal response.
  return {
    kind: "completed",
    movementId,
    body: (observed.body ?? {}) as unknown as TBody,
  };
}
