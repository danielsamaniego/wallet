import type { Client } from "@upstash/qstash";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type {
  IMovementQueuePublisher,
  MovementQueueMessage,
} from "../../../../domain/ports/movement.queue.publisher.js";

const mainLogTag = "QStashMovementQueuePublisher";

/**
 * Adapter for `IMovementQueuePublisher` that schedules a movement for
 * asynchronous processing through QStash. The queue throttle
 * (`parallelism`) is configured once at wiring time via `client.queue({
 * queueName }).upsert({ parallelism })` — this publisher only enqueues.
 *
 * The HTTP destination is the internal worker route — `POST
 * /internal/worker/process-movement` — and the message body is
 * intentionally minimal (`{ movement_id }`). The worker re-loads the
 * persisted Movement so the queue payload never drifts out of sync with
 * the DB.
 *
 * `idempotencyKey` (when present) is forwarded as `deduplicationId` so
 * accidentally-duplicated publishes (e.g. handler retries before the
 * caller can ack) are deduped at the queue layer before any worker is
 * invoked. This is dedup BEFORE delivery and does NOT replace the
 * application-level `IdempotencyRecord` guarantee.
 */
export class QStashMovementQueuePublisher implements IMovementQueuePublisher {
  constructor(
    private readonly client: Client,
    private readonly queueName: string,
    private readonly destinationUrl: string,
    private readonly logger: ILogger,
  ) {}

  async publish(ctx: AppContext, message: MovementQueueMessage): Promise<void> {
    const methodLogTag = `${mainLogTag} | publish`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      movement_id: message.movementId,
      queue: this.queueName,
      deduplication_id: message.idempotencyKey ?? null,
    });

    const response = await this.client.queue({ queueName: this.queueName }).enqueueJSON({
      url: this.destinationUrl,
      body: { movement_id: message.movementId },
      ...(message.idempotencyKey !== undefined ? { deduplicationId: message.idempotencyKey } : {}),
    });

    this.logger.info(ctx, `${methodLogTag} enqueued`, {
      movement_id: message.movementId,
      queue: this.queueName,
      qstash_message_id: (response as { messageId?: string }).messageId ?? null,
    });
  }
}
