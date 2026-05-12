import type { Redis } from "ioredis";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type {
  IResultPublisher,
  MovementResult,
} from "../../../../domain/ports/result.publisher.js";

const mainLogTag = "RedisResultPublisher";

/**
 * Redis-backed implementation of `IResultPublisher`. Used by the async
 * worker (Phase 2B.4+) after the business transaction commits to notify
 * the original HTTP handler — which is polling on the same key — that
 * the movement reached its terminal state.
 *
 * Two writes per publish:
 *   1. `SET movement:result:{id}` with a short TTL. Acts as the result
 *      cache so a handler that polls AFTER the worker's publish still
 *      observes the result on its next GET. This is the durable side of
 *      the contract.
 *   2. `PUBLISH movement:result:{id}` for any active pub/sub subscriber
 *      that wants to wake immediately. Cosmetic on the polling-based
 *      subscriber (`RedisResultSubscriber`), but kept for symmetry with
 *      a future SUBSCRIBE-based subscriber.
 *
 * The PUBLISH+SET ordering closes the race window where a handler might
 * start polling between the two: the SET happens first so the
 * subscriber's very next GET observes it; PUBLISH is the fast-path
 * wake-up, never the source of truth.
 */
export class RedisResultPublisher implements IResultPublisher {
  /** Redis key TTL in seconds. Tuned so the subscriber has a generous
   * grace period after its own wait window expires but the key is gone
   * quickly enough to not accumulate. */
  private static readonly DEFAULT_TTL_SECONDS = 60;

  constructor(
    private readonly redis: Redis,
    private readonly logger: ILogger,
    private readonly ttlSeconds: number = RedisResultPublisher.DEFAULT_TTL_SECONDS,
  ) {}

  async publish(ctx: AppContext, result: MovementResult): Promise<void> {
    const methodLogTag = `${mainLogTag} | publish`;
    const key = `movement:result:${result.movementId}`;
    const payload = JSON.stringify(result);

    this.logger.debug(ctx, `${methodLogTag} start`, {
      movement_id: result.movementId,
      status: result.status,
      key,
    });

    await this.redis.set(key, payload, "EX", this.ttlSeconds);
    await this.redis.publish(key, payload);

    this.logger.info(ctx, `${methodLogTag} published`, {
      movement_id: result.movementId,
      status: result.status,
    });
  }
}
