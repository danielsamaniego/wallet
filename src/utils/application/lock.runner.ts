import { AppError } from "../kernel/appError.js";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";
import {
  type IDistributedLock,
  LockBackendUnavailableError,
  LockContendedError,
  type LockOptions,
} from "./distributed.lock.js";

const mainLogTag = "LockRunner";

/**
 * LockRunner bundles an optional IDistributedLock with its runtime options
 * and a logger. Use cases inject LockRunner when they need to serialize
 * concurrent operations on a logical resource, without caring about the
 * underlying Redis / in-memory / absent wiring.
 *
 * Contracts:
 *   - lock = undefined → runs fn directly, no locking. This is how the
 *     feature is toggled off (e.g. WALLET_LOCK_ENABLED=false): wiring
 *     injects a LockRunner with lock=undefined and use cases keep working.
 *   - lock present + key contended within waitMs → converts to
 *     AppError.conflict("LOCK_CONTENDED", ...) so the HTTP layer maps
 *     it to 409 and the caller retries with the same idempotency key.
 *   - lock present + backend unreachable → logs a warn and falls through
 *     to fn without the lock, so transient Redis outages do not cause
 *     outages of the wallet service.
 *
 * LockRunner is generic by design: it does not know about wallets, users,
 * payments, or any other resource. Callers pass arbitrary string keys and
 * the runner forwards them to the underlying lock adapter.
 */
export class LockRunner {
  /**
   * `lock=undefined` is RESERVED for `wiring` to express "feature disabled"
   * (WALLET_LOCK_ENABLED=false, or REDIS_URL missing). It is the ONLY supported
   * off-switch for the lock — application code and tests must NOT construct a
   * LockRunner with `undefined` to bypass it. Tests that need a no-op runner
   * should use `createMockLockRunner()` from the test helpers.
   */
  constructor(
    private readonly lock: IDistributedLock | undefined,
    private readonly options: LockOptions,
    private readonly logger: ILogger,
  ) {}

  /**
   * Runs fn while holding locks on the given keys.
   *
   * Log events:
   *   - debug "run start"         — about to acquire (keys + options)
   *   - debug "run skipped"       — lock is undefined → fn executed directly
   *   - debug "run completed"     — fn finished under locks (keys, duration_ms)
   *   - warn  "backend down"      — fallthrough without lock (keys, error)
   *   - warn  "contended"         — rejected with LOCK_CONTENDED (key, wait_ms)
   *
   * Canonical metrics (per-request, additive if the runner is called more
   * than once during the request — e.g. two sequential mutations):
   *   - lock.acquired          — count of successful lockRunner.run calls
   *   - lock.contended         — count of LOCK_CONTENDED outcomes (→ HTTP 409)
   *   - lock.fallthrough       — count of fallthroughs due to backend down
   *   - lock.duration_ms       — total time spent inside lockRunner.run
   *   The adapter emits additional metrics (`lock.attempts`,
   *   `lock.transient_errors`, `lock.token_mismatch`).
   */
  async run<T>(ctx: AppContext, keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    if (!this.lock) {
      this.logger.debug(ctx, `${mainLogTag} run skipped`, {
        keys,
        reason: "lock disabled",
      });
      return fn();
    }

    this.logger.debug(ctx, `${mainLogTag} run start`, {
      keys,
      ttl_ms: this.options.ttlMs,
      wait_ms: this.options.waitMs,
    });

    const startedAt = Date.now();
    try {
      const result = await this.lock.withLocks(ctx, keys, this.options, fn);
      const durationMs = Date.now() - startedAt;
      this.logger.incrementCanonical(ctx, "lock.acquired", 1);
      this.logger.incrementCanonical(ctx, "lock.duration_ms", durationMs);
      this.logger.debug(ctx, `${mainLogTag} run completed`, {
        keys,
        duration_ms: durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err instanceof LockBackendUnavailableError) {
        // LockBackendUnavailableError's constructor only accepts Error | undefined,
        // so `cause` is always either Error or absent — no instanceof guard needed.
        const causeErr = (err as { cause?: Error }).cause;
        this.logger.incrementCanonical(ctx, "lock.fallthrough", 1);
        this.logger.incrementCanonical(ctx, "lock.duration_ms", durationMs);
        this.logger.warn(ctx, `${mainLogTag} backend down, proceeding without lock`, {
          keys,
          duration_ms: durationMs,
          error: err.message,
          ...(causeErr
            ? {
                cause_name: causeErr.name,
                cause_message: causeErr.message,
                ...((causeErr as { code?: unknown }).code !== undefined
                  ? { cause_code: String((causeErr as { code?: unknown }).code) }
                  : {}),
              }
            : {}),
        });
        return fn();
      }
      if (err instanceof LockContendedError) {
        this.logger.incrementCanonical(ctx, "lock.contended", 1);
        this.logger.incrementCanonical(ctx, "lock.duration_ms", durationMs);
        this.logger.warn(ctx, `${mainLogTag} contended, rejecting with LOCK_CONTENDED`, {
          key: err.key,
          wait_ms: durationMs,
        });
        throw AppError.conflict(
          "LOCK_CONTENDED",
          `resource ${err.key} is busy; retry with the same idempotency key`,
        );
      }
      throw err;
    }
  }
}
