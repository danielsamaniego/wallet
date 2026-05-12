import { ICommand } from "../../../../utils/application/cqrs.js";
import type {
  MovementQueuePayload,
  MovementType,
} from "../../../domain/movement/movement.entity.js";

export interface EnqueueMovementResult {
  movementId: string;
}

/**
 * Command dispatched by HTTP handlers in async mode (Phase 2B.6+, behind
 * `WALLET_ASYNC_PROCESSING_ENABLED`). Wraps the original operation: the
 * handler turns its specific command (DepositCommand, WithdrawCommand, …)
 * into a `type` + `queuePayload` pair and hands it off to this use case,
 * which persists a `pending` Movement and publishes it to QStash. The
 * worker later loads the persisted Movement, narrows `queuePayload` by
 * `type`, and dispatches the matching `<op>Service.execute`.
 *
 * The handler is responsible for putting the right shape into
 * `queuePayload`. The use case does NOT inspect it — `queuePayload` is
 * opaque at this layer. Loose typing is intentional; the worker's
 * deserialiser narrows by `type`.
 *
 * `idempotencyKey` is forwarded to the queue publisher as
 * `deduplicationId` so accidentally-duplicated publishes are dropped at
 * the queue layer. This is *queue-level* dedup; the
 * application-level IdempotencyRecord guarantee still flows through the
 * existing HTTP middleware, untouched.
 */
export class EnqueueMovementCommand extends ICommand<EnqueueMovementResult> {
  static readonly TYPE = "EnqueueMovement";

  constructor(
    public readonly type: MovementType,
    public readonly platformId: string,
    public readonly idempotencyKey: string,
    public readonly queuePayload: MovementQueuePayload,
    public readonly reason?: string | null,
  ) {
    super(EnqueueMovementCommand.TYPE);
  }
}
