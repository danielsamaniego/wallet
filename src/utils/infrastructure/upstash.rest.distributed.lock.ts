import type { Redis } from "@upstash/redis";
import {
  type IDistributedLock,
  LockBackendUnavailableError,
  LockContendedError,
  type LockHandle,
  type LockOptions,
} from "../application/distributed.lock.js";
import type { IIDGenerator } from "../application/id.generator.js";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";

const mainLogTag = "UpstashRestDistributedLock";

/**
 * Lua script for safe release: delete the key only if its value matches the
 * token. Prevents releasing a lock that was re-acquired by another holder
 * after TTL expiry. Matches the TCP adapter's script exactly — wire-level
 * semantics must not drift between transports.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts diagnostic fields from an error for structured logging.
 */
function errorFields(err: Error): Record<string, unknown> {
  const code = (err as { code?: unknown }).code;
  return {
    error: err.message,
    error_name: err.name,
    ...(code !== undefined ? { error_code: String(code) } : {}),
  };
}

/**
 * Parses an Upstash `rediss://default:TOKEN@HOST:PORT` connection string into
 * the `{ url, token }` shape that `@upstash/redis` expects. REST and TCP use
 * the same credentials — the host has an HTTPS endpoint on 443 and a TCP
 * endpoint on 6379; the token is the password component in both cases.
 *
 * Throws when the input is not a valid URL or has no password component.
 */
export function parseUpstashRestCredentials(connectionString: string): {
  url: string;
  token: string;
} {
  const u = new URL(connectionString);
  if (!u.password) {
    throw new Error(
      "REDIS_URL is missing the token (password component). " +
        "Expected format: rediss://default:<token>@<host>:<port>.",
    );
  }
  return { url: `https://${u.hostname}`, token: u.password };
}

/**
 * REST/HTTP implementation of IDistributedLock backed by @upstash/redis.
 *
 * Why REST over TCP (ioredis):
 *   - Serverless cold bursts open a fresh TCP connection per invocation, which
 *     exhausts the provider's per-DB quota (Upstash: EMAXCONN at 200/1000).
 *     HTTP is stateless — every command is an independent request, unaffected
 *     by peak concurrency.
 *
 * Trade-offs:
 *   - Latency per op: ~10-30ms (HTTP overhead) vs ~1-5ms (TCP).
 *   - No persistent pub/sub — not used here.
 *
 * Protocol matches RedisDistributedLock exactly so either transport can run
 * against the same Upstash DB without corrupting lock state:
 *   - acquire: SET key token NX PX ttlMs in a loop with backoff.
 *   - release: token-aware Lua EVAL (DEL only if value matches).
 *
 * Canonical metrics (per-request; additive across multiple acquires):
 *   - lock.attempts         — every SET NX call
 *   - lock.token_mismatch   — release found a different token (TTL expired
 *                             mid-critical-section, or key was stolen)
 *   Complementary metrics emitted by `LockRunner`: `lock.acquired`,
 *   `lock.contended`, `lock.fallthrough`, `lock.duration_ms`.
 *
 * Error handling:
 *   - SET returns null (already held) → retry within waitMs, then
 *     LockContendedError (HTTP 409).
 *   - Any thrown error (network, auth, HTTP 5xx) → LockBackendUnavailableError
 *     so the LockRunner can fall through to optimistic-locking safeguards.
 */
export class UpstashRestDistributedLock implements IDistributedLock {
  constructor(
    private readonly redis: Redis,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  /**
   * Log events:
   *   - debug `acquire start`  — every call
   *   - debug `acquire ok`     — first-attempt success
   *   - info  `acquire ok after contention` — caller had to wait
   *   - warn  `acquire contended` — waitMs exceeded (LockContendedError)
   *   - warn  `acquire backend error` — backend unreachable
   *                                     (LockBackendUnavailableError)
   */
  async acquire(ctx: AppContext, key: string, options: LockOptions): Promise<LockHandle> {
    const methodLogTag = `${mainLogTag} | acquire`;
    const retryMs = options.retryMs ?? 50;
    const startedAt = Date.now();
    const deadline = startedAt + options.waitMs;
    const token = this.idGen.newId();
    let attempts = 0;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      key,
      ttl_ms: options.ttlMs,
      wait_ms: options.waitMs,
      retry_ms: retryMs,
    });

    while (true) {
      attempts++;
      this.logger.incrementCanonical(ctx, "lock.attempts", 1);
      let acquired: string | null;
      try {
        // `as string | null` because @upstash/redis's set() is generic over
        // the encoded value type and here the client returns "OK" or null.
        acquired = (await this.redis.set(key, token, {
          nx: true,
          px: options.ttlMs,
        })) as string | null;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(ctx, `${methodLogTag} backend error`, {
          key,
          attempts,
          wait_elapsed_ms: Date.now() - startedAt,
          ...errorFields(e),
        });
        throw new LockBackendUnavailableError(e);
      }

      if (acquired === "OK") {
        const waitMs = Date.now() - startedAt;
        if (attempts === 1) {
          this.logger.debug(ctx, `${methodLogTag} ok`, {
            key,
            token,
            attempts,
            wait_ms: waitMs,
          });
        } else {
          this.logger.info(ctx, `${methodLogTag} ok after contention`, {
            key,
            token,
            attempts,
            wait_ms: waitMs,
          });
        }
        return this.buildHandle(ctx, key, token);
      }

      const now = Date.now();
      if (now >= deadline) {
        this.logger.warn(ctx, `${methodLogTag} contended`, {
          key,
          attempts,
          wait_ms: now - startedAt,
        });
        throw new LockContendedError(key);
      }
      const remaining = deadline - now;
      await sleep(Math.min(retryMs, remaining));
    }
  }

  /**
   * Log events (beyond acquire's):
   *   - debug `withLock done` — fn completed, total duration
   *   - warn  `release failed` — release rejected (swallowed)
   */
  async withLock<T>(
    ctx: AppContext,
    key: string,
    options: LockOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const methodLogTag = `${mainLogTag} | withLock`;
    const startedAt = Date.now();
    const handle = await this.acquire(ctx, key, options);
    try {
      return await fn();
    } finally {
      this.logger.debug(ctx, `${methodLogTag} done`, {
        key,
        token: handle.token,
        duration_ms: Date.now() - startedAt,
      });
      await handle.release().catch((err: Error) => {
        this.logger.warn(ctx, `${methodLogTag} release failed`, {
          key,
          token: handle.token,
          ...errorFields(err),
        });
      });
    }
  }

  /**
   * Acquire multiple locks in sorted order, run fn, release in reverse.
   *
   * Log events (beyond acquire's):
   *   - debug `withLocks start`  — entry (sorted keys)
   *   - debug `withLocks done`   — fn completed, total duration
   *   - warn  `release failed`   — individual release rejected (swallowed)
   */
  async withLocks<T>(
    ctx: AppContext,
    keys: readonly string[],
    options: LockOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const methodLogTag = `${mainLogTag} | withLocks`;
    const sortedKeys = [...new Set(keys)].sort();
    const startedAt = Date.now();

    this.logger.debug(ctx, `${methodLogTag} start`, {
      keys: sortedKeys,
      count: sortedKeys.length,
    });

    const handles: LockHandle[] = [];
    try {
      for (const key of sortedKeys) {
        const handle = await this.acquire(ctx, key, options);
        handles.push(handle);
      }
      return await fn();
    } finally {
      this.logger.debug(ctx, `${methodLogTag} done`, {
        keys: sortedKeys,
        acquired: handles.length,
        duration_ms: Date.now() - startedAt,
      });
      for (const h of [...handles].reverse()) {
        await h.release().catch((err: Error) => {
          this.logger.warn(ctx, `${methodLogTag} release failed`, {
            key: h.key,
            token: h.token,
            ...errorFields(err),
          });
        });
      }
    }
  }

  /**
   * Log events:
   *   - debug `release ok`             — token matched and DEL succeeded
   *   - warn  `release token mismatch` — DEL returned 0 (TTL expired or stolen)
   *   - warn  `release backend error`  — eval rejected
   *                                      (LockBackendUnavailableError)
   */
  private buildHandle(ctx: AppContext, key: string, token: string): LockHandle {
    const methodLogTag = `${mainLogTag} | release`;
    return {
      key,
      token,
      release: async () => {
        const startedAt = Date.now();
        try {
          // The Lua script returns an integer: 1 on DEL success, 0 when the
          // token did not match. @upstash/redis returns it as a number.
          const result = (await this.redis.eval(RELEASE_SCRIPT, [key], [token])) as number;
          const durationMs = Date.now() - startedAt;
          if (result === 1) {
            this.logger.debug(ctx, `${methodLogTag} ok`, {
              key,
              token,
              duration_ms: durationMs,
            });
          } else {
            this.logger.incrementCanonical(ctx, "lock.token_mismatch", 1);
            this.logger.warn(ctx, `${methodLogTag} token mismatch`, {
              key,
              token,
              duration_ms: durationMs,
              reason: "TTL expired before fn finished, or key was stolen",
            });
          }
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          this.logger.warn(ctx, `${methodLogTag} backend error`, {
            key,
            token,
            ...errorFields(e),
          });
          throw new LockBackendUnavailableError(e);
        }
      },
    };
  }
}
