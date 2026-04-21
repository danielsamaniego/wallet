import type { Redis } from "ioredis";
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

const mainLogTag = "RedisDistributedLock";

/**
 * Lua script for safe release: delete the key only if its value matches the token.
 * This prevents releasing a lock that was re-acquired by another holder after TTL expiry.
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
 * Distinguishes "slow Redis during contention" from "backend truly down".
 *
 * The only signal currently treated as retry-able is ioredis's
 * `Command timed out` — emitted when a single command exceeds `commandTimeout`
 * while the connection is still alive. Under contention polling (50 requests
 * hammering the same key, managed Redis cross-region, GC pauses, etc.) a
 * single SET NX can tail-latency past the deadline while the backend is
 * perfectly reachable on the next attempt.
 *
 * Everything else (ECONNREFUSED, ENOTFOUND, TLS handshake, NOAUTH, WRONGPASS,
 * `max retries per request`) is treated as backend-down: retrying wastes
 * waitMs budget, so we fall through immediately and let the caller proceed
 * under optimistic-locking safeguards.
 */
function isTransient(err: Error): boolean {
  return err.message.toLowerCase().includes("command timed out");
}

/**
 * Extracts diagnostic fields from an error for structured logging.
 * Includes `error_code` when the runtime attaches one (e.g. ioredis system
 * errors: ECONNREFUSED, ENOTFOUND, ECONNRESET; TLS errors like
 * CERT_HAS_EXPIRED). When an unknown error class appears, the name + code let
 * the operator classify it and extend `isTransient` if appropriate.
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
 * Redis-backed implementation of IDistributedLock using ioredis.
 *
 * Protocol:
 *   - acquire: SET key token NX PX ttlMs in a loop with backoff.
 *   - release: Lua script that checks token match before DEL.
 *
 * Observability: emits structured logs at debug/info/warn levels so production
 * incidents can be reconstructed from logs alone. Every log line includes the
 * `key` and a correlation id via AppContext.trackingId. See docstrings on each
 * method for the log vocabulary.
 *
 * Canonical metrics (per-request; additive across multiple acquires):
 *   - lock.attempts         — every SET NX call (retries included)
 *   - lock.transient_errors — "Command timed out" retries absorbed
 *   - lock.token_mismatch   — release found a different token (TTL expired
 *                             mid-critical-section, or key stolen)
 *   Complementary metrics emitted by `LockRunner`: `lock.acquired`,
 *   `lock.contended`, `lock.fallthrough`, `lock.duration_ms`.
 */
export class RedisDistributedLock implements IDistributedLock {
  constructor(
    private readonly redis: Redis,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  /**
   * Attempts to acquire a lock by polling `SET key token PX ttlMs NX` until it
   * succeeds or `waitMs` elapses.
   *
   * Log events:
   *   - debug `acquire start`  — every call (key, ttl_ms, wait_ms)
   *   - debug `acquire ok`     — first-attempt success (no contention)
   *   - info  `acquire after contention` — when the caller had to wait
   *                                        (key, attempts, wait_ms)
   *   - warn  `acquire contended` — waitMs exceeded (rejected with
   *                                  LockContendedError)
   *   - warn  `acquire backend error` — backend unreachable
   *                                      (wrapped as LockBackendUnavailableError)
   */
  async acquire(ctx: AppContext, key: string, options: LockOptions): Promise<LockHandle> {
    const methodLogTag = `${mainLogTag} | acquire`;
    const retryMs = options.retryMs ?? 50;
    const startedAt = Date.now();
    const deadline = startedAt + options.waitMs;
    const token = this.idGen.newId();
    let attempts = 0;
    // Track whether we ever got a real answer from Redis during the loop.
    // If every attempt timed out (sawResponse stays false) we know the backend
    // isn't talking to us — prefer LockBackendUnavailableError over
    // LockContendedError so the runner falls through instead of 409'ing.
    let sawResponse = false;
    let lastTransientErr: Error | undefined;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      key,
      ttl_ms: options.ttlMs,
      wait_ms: options.waitMs,
      retry_ms: retryMs,
    });

    while (true) {
      attempts++;
      this.logger.incrementCanonical(ctx, "lock.attempts", 1);
      let acquired: "OK" | null;
      try {
        acquired = await this.redis.set(key, token, "PX", options.ttlMs, "NX");
        sawResponse = true;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!isTransient(e)) {
          this.logger.warn(ctx, `${methodLogTag} backend error`, {
            key,
            attempts,
            wait_elapsed_ms: Date.now() - startedAt,
            ...errorFields(e),
          });
          throw new LockBackendUnavailableError(e);
        }
        // Transient (command timeout): log at debug, treat as "not acquired",
        // and let the loop retry within the waitMs budget.
        lastTransientErr = e;
        this.logger.incrementCanonical(ctx, "lock.transient_errors", 1);
        this.logger.debug(ctx, `${methodLogTag} transient error, retrying`, {
          key,
          attempts,
          ...errorFields(e),
        });
        acquired = null;
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
        if (!sawResponse && lastTransientErr) {
          this.logger.warn(ctx, `${methodLogTag} backend unresponsive throughout wait`, {
            key,
            attempts,
            wait_ms: now - startedAt,
            ...errorFields(lastTransientErr),
          });
          throw new LockBackendUnavailableError(lastTransientErr);
        }
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
   * Acquires, runs fn, releases in finally.
   *
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
      // release() is guaranteed to throw Error (LockBackendUnavailableError)
      // or nothing — see buildHandle().
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
   * Acquires multiple locks in sorted order, runs fn, releases in reverse.
   *
   * Log events (beyond acquire's):
   *   - debug `withLocks start`     — entry (sorted keys)
   *   - debug `withLocks done`      — fn completed, total duration
   *   - warn  `release failed`      — individual release rejected (swallowed)
   */
  async withLocks<T>(
    ctx: AppContext,
    keys: readonly string[],
    options: LockOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const methodLogTag = `${mainLogTag} | withLocks`;
    // Deduplicate: acquiring the same key twice would self-deadlock.
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
      // Release in reverse order (last-acquired released first).
      // `handles` is a locally-owned array indexed within its own length, so
      // each element is guaranteed present; we iterate over a reversed copy to
      // avoid the non-null assertion.
      for (const h of [...handles].reverse()) {
        // release() is guaranteed to throw Error (LockBackendUnavailableError)
        // or nothing — see buildHandle().
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
   * Builds a handle whose release runs the token-aware Lua script.
   *
   * Log events:
   *   - debug `release ok`           — token matched and DEL succeeded (happy path)
   *   - warn  `release token mismatch` — DEL returned 0: the lock's TTL expired
   *                                      while fn was still running, OR another
   *                                      holder already took the key. This is
   *                                      a correctness concern: two callers may
   *                                      have overlapped in the critical section.
   *                                      Tune by raising WALLET_LOCK_TTL_MS or
   *                                      shortening the critical section.
   *   - warn  `release backend error` — eval rejected (wrapped as
   *                                     LockBackendUnavailableError)
   */
  private buildHandle(ctx: AppContext, key: string, token: string): LockHandle {
    const methodLogTag = `${mainLogTag} | release`;
    return {
      key,
      token,
      release: async () => {
        const startedAt = Date.now();
        try {
          const result = await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
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
