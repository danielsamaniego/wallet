import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementQueuePublisher } from "../../../domain/ports/movement.queue.publisher.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { EnqueueMovementCommand, EnqueueMovementResult } from "./command.js";

const mainLogTag = "EnqueueMovementUseCase";

/**
 * Async-path entry point. The HTTP handler dispatches this command (instead
 * of the operation-specific one, e.g. DepositCommand) when
 * WALLET_ASYNC_PROCESSING_ENABLED is on. The use case:
 *
 *   1. Generates a fresh `movement_id`.
 *   2. INSERTs a `Movement(status='pending', platform_id, queue_payload)`.
 *   3. Publishes `{ movement_id, idempotencyKey }` to QStash.
 *   4. Returns the id so the handler can wait on Redis pub/sub or
 *      fall back to 202.
 *
 * No lock + tx envelope here: the only DB write is a single INSERT
 * (idempotent on `movement.id`) and the queue publish is external. If
 * the publish fails after INSERT, the pending row is left for the
 * reconciliation job to either republish or mark failed. Extending the
 * state machine to allow a direct `pending → failed` rollback is a
 * later concern.
 */
export class EnqueueMovementUseCase
  implements ICommandHandler<EnqueueMovementCommand, EnqueueMovementResult>
{
  constructor(
    private readonly movementRepo: IMovementRepository,
    private readonly queuePublisher: IMovementQueuePublisher,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: EnqueueMovementCommand): Promise<EnqueueMovementResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    const movementId = this.idGen.newId();

    this.logger.debug(ctx, `${methodLogTag} start`, {
      movement_id: movementId,
      type: cmd.type,
      platform_id: cmd.platformId,
    });

    const movement = Movement.create({
      id: movementId,
      type: cmd.type,
      platformId: cmd.platformId,
      status: "pending",
      reason: cmd.reason ?? null,
      queuePayload: cmd.queuePayload,
      createdAt: Date.now(),
    });

    // Save first so the worker's later GET-by-id (after queue delivery) always
    // finds a row. If publish fails after this, the pending row becomes a
    // reconciliation-job concern, never a "delivered message with no row" bug.
    await this.movementRepo.save(ctx, movement);

    await this.queuePublisher.publish(ctx, {
      movementId,
      idempotencyKey: cmd.idempotencyKey,
    });

    this.logger.info(ctx, `${methodLogTag} enqueued`, {
      movement_id: movementId,
      type: cmd.type,
    });

    return { movementId };
  }
}
