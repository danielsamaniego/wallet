import type { Redis } from "ioredis";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { MovementResult } from "../../../../domain/ports/result.publisher.js";

const mainLogTag = "RedisResultSubscriber";

export interface ResultSubscriberOptions {
  /** Maximum total time to wait for a result before returning `null`. */
  timeoutMs: number;
  /** Interval between GET probes. Default: 50 ms. */
  pollMs?: number;
}

/**
 * Reader half of the async-processing "sync illusion" pattern. The HTTP
 * handler calls `waitFor(movementId, { timeoutMs })` right after
 * dispatching `EnqueueMovementCommand`. The method polls
 * `movement:result:{id}` (set by `RedisResultPublisher` when the worker
 * commits) and returns:
 *
 *   - `MovementResult` when the worker beats the timeout → handler
 *     returns 200 OK with the full body
 *   - `null` when the timeout fires first → handler returns
 *     `202 Accepted` and the client polls `GET /v1/movements/{id}`
 *
 * Polling (vs SUBSCRIBE) is deliberate: serverless functions and
 * Upstash REST do not maintain long-lived connections, so a poll loop
 * is cheaper than holding a dedicated subscriber connection per
 * request. Per-poll cost is one Redis GET; at the default 50 ms
 * cadence with 1500 ms timeout, worst case is ~30 GETs (a few cents at
 * scale, far cheaper than 202+polling-from-the-client when the worker
 * does beat the timeout).
 *
 * Errors from Redis are swallowed and the subscriber continues
 * polling; if the backend stays unhealthy for the whole window, the
 * caller observes a timeout and falls back to 202.
 */
export class RedisResultSubscriber {
  private static readonly DEFAULT_POLL_MS = 50;

  constructor(
    private readonly redis: Redis,
    private readonly logger: ILogger,
  ) {}

  async waitFor(
    ctx: AppContext,
    movementId: string,
    opts: ResultSubscriberOptions,
  ): Promise<MovementResult | null> {
    const methodLogTag = `${mainLogTag} | waitFor`;
    const key = `movement:result:${movementId}`;
    const pollMs = opts.pollMs ?? RedisResultSubscriber.DEFAULT_POLL_MS;
    const deadline = Date.now() + opts.timeoutMs;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      movement_id: movementId,
      timeout_ms: opts.timeoutMs,
      poll_ms: pollMs,
    });

    while (Date.now() < deadline) {
      let value: string | null = null;
      try {
        value = await this.redis.get(key);
      } catch (err) {
        // Transient Redis blip: keep polling, the next GET may succeed.
        // If the whole window expires, the caller falls back to 202.
        this.logger.warn(ctx, `${methodLogTag} redis error during poll`, {
          movement_id: movementId,
          error: (err as Error).message,
        });
      }

      if (value !== null) {
        this.logger.info(ctx, `${methodLogTag} result observed`, {
          movement_id: movementId,
        });
        return JSON.parse(value) as MovementResult;
      }

      // Sleep only if there is meaningful time left. If the deadline has
      // already passed during the GET, fall through; the while-condition
      // catches it on the next iteration.
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await sleep(Math.min(pollMs, remaining));
      }
    }

    this.logger.info(ctx, `${methodLogTag} timeout`, {
      movement_id: movementId,
      timeout_ms: opts.timeoutMs,
    });
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
