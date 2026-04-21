import type { AppContext } from "../kernel/context.js";

/**
 * Options for acquiring a distributed lock.
 *
 * - ttlMs:     how long the lock is held before auto-expiring. Safety net for
 *              holders that crash without releasing. Should be significantly
 *              longer than any legitimate critical section.
 * - waitMs:    how long the caller waits trying to acquire the lock before
 *              giving up with LOCK_CONTENDED. Should be shorter than the HTTP
 *              request timeout so callers don't time out waiting in the queue.
 * - retryMs:   polling interval between acquisition attempts while waiting.
 *              Defaults to 50ms.
 */
export interface LockOptions {
  readonly ttlMs: number;
  readonly waitMs: number;
  readonly retryMs?: number;
}

/**
 * Handle returned by a successful acquire. Release the lock via handle.release().
 * Implementations safely release only if the token still matches the lock value
 * (prevents releasing a lock that was re-acquired by someone else after TTL expiry).
 */
export interface LockHandle {
  readonly key: string;
  readonly token: string;
  release(): Promise<void>;
}

/**
 * Port for a distributed mutex. Implementations serialize access to a
 * given key across all callers of the wallet service.
 *
 * Key use cases:
 *   - Per-wallet serialization of write operations to prevent optimistic
 *     locking version conflicts under concurrent load.
 *   - Ordering guarantees for financial operations targeting the same wallet.
 *
 * Failure modes:
 *   - Contention beyond waitMs: throws LockContendedError (wrap to HTTP 409).
 *   - Backend unreachable: throws LockBackendUnavailableError. Callers that
 *     need graceful degradation catch this and proceed without the lock.
 */
export interface IDistributedLock {
  /**
   * Attempt to acquire a single lock.
   *
   * @throws LockContendedError when waitMs elapsed without acquiring.
   * @throws LockBackendUnavailableError when the backend cannot be reached.
   */
  acquire(ctx: AppContext, key: string, options: LockOptions): Promise<LockHandle>;

  /**
   * Acquire, run fn, release in finally. Release errors are swallowed and logged
   * by the implementation to avoid masking the original fn outcome.
   */
  withLock<T>(ctx: AppContext, key: string, options: LockOptions, fn: () => Promise<T>): Promise<T>;

  /**
   * Acquire multiple locks atomically in sorted order, run fn, release in
   * reverse order. Ordering prevents deadlocks when two callers need the
   * same pair of locks (e.g. transfer A->B vs B->A).
   *
   * If fn or any release throws, previously acquired locks are still released
   * in reverse order. Release errors are swallowed and logged.
   *
   * @throws LockContendedError if any key contends beyond waitMs. Any locks
   *         acquired before the contention are released first.
   */
  withLocks<T>(
    ctx: AppContext,
    keys: readonly string[],
    options: LockOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
}

/**
 * Thrown when acquire cannot obtain the lock within waitMs.
 * Callers should retry with the same idempotency key.
 */
export class LockContendedError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`lock contended: ${key}`);
    this.name = "LockContendedError";
    this.key = key;
  }
}

/**
 * Thrown when the lock backend is unreachable (network, auth, config).
 * `LockRunner` degrades by falling through without the lock, relying on
 * downstream safeguards (optimistic locking, retries).
 */
export class LockBackendUnavailableError extends Error {
  constructor(cause?: Error) {
    super(cause ? `lock backend unavailable: ${cause.message}` : "lock backend unavailable");
    this.name = "LockBackendUnavailableError";
    if (cause) this.cause = cause;
  }
}
