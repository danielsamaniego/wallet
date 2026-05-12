import { Prisma } from "@prisma/client";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";

const mainLogTag = "PrismaConnectionRetry";

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 2000;
const DEFAULT_JITTER_MS = 100;

/**
 * Recognises transient errors that should be retried transparently.
 *
 * The match is substring-based on the error message because the exact
 * surface varies across the stack: `pg` raises libpq-style codes,
 * PgBouncer forwards server-side strings verbatim, and `@prisma/adapter-pg`
 * wraps them with its own prefix. Covered signals:
 *
 *   - `EMAXCONN` / `max client connections` — Supabase PgBouncer cap reached
 *     (compute size fixes `max_client_conn`; under burst of cold serverless
 *     invocations the pooler rejects new clients until existing ones release)
 *   - `too many clients` — Postgres server-side client cap
 *   - `connection terminated` / `ECONNRESET` / `ETIMEDOUT` — transient socket
 *     drops, usually during pool rotation or brief network hiccups
 *   - `ECONNREFUSED` — pooler restarted or briefly unavailable
 *
 * Domain errors (VERSION_CONFLICT, unique constraint violations, validation)
 * do NOT match — they belong to higher layers (TransactionManager,
 * use cases) and must not be retried blindly at the infra level.
 */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("emaxconn") ||
    msg.includes("max client connections") ||
    msg.includes("too many clients") ||
    msg.includes("connection terminated") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  logger?: ILogger;
  ctx?: AppContext;
  operation?: string;
  model?: string;
  now?: () => number;
  random?: () => number;
}

/**
 * Executes `fn` with exponential-backoff retry on connection-level errors.
 *
 * Backoff schedule with defaults (base=200ms, cap=2000ms, jitter=0-100ms):
 *
 *   Attempt 1 fail → sleep min(200,   2000) + j = ~250ms
 *   Attempt 2 fail → sleep min(400,   2000) + j = ~450ms
 *   Attempt 3 fail → sleep min(800,   2000) + j = ~850ms
 *   Attempt 4 fail → sleep min(1600,  2000) + j = ~1650ms
 *   Attempt 5 fail → sleep min(3200,  2000) + j = ~2050ms
 *   Attempt 6 fail → sleep min(6400,  2000) + j = ~2050ms
 *   Attempt 7 fail → sleep min(12800, 2000) + j = ~2050ms
 *   Attempt 8     → last attempt, throws on failure
 *
 *   Total wait budget: ~9.3s (≤ 10s target). Fits comfortably under the
 *   25s `maxDuration` even accounting for ~100-500ms of actual query work.
 *
 * The cap (`maxDelayMs`) prevents exponential explosion on later attempts so
 * we get more retries within the budget — more chances to catch a freed
 * connection as other instances finish their transactions.
 *
 * Non-connection errors re-throw immediately; they must not be absorbed.
 */
export async function retryOnConnectionError<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterMs = opts.jitterMs ?? DEFAULT_JITTER_MS;
  const random = opts.random ?? Math.random;

  // `while (true)` instead of a bounded `for` loop so TypeScript's flow
  // analysis sees the function as never falling through — the loop body
  // always either `return`s on success or `throw`s on failure.
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      if (!isConnectionError(err) || isLast) throw err;
      const expDelayMs = baseDelayMs * 2 ** (attempt - 1);
      const cappedDelayMs = Math.min(expDelayMs, maxDelayMs);
      const delayMs = cappedDelayMs + random() * jitterMs;
      if (opts.logger && opts.ctx) {
        opts.logger.warn(opts.ctx, `${mainLogTag} retrying after connection error`, {
          attempt,
          max_attempts: maxAttempts,
          next_delay_ms: Math.round(delayMs),
          operation: opts.operation,
          model: opts.model,
          error: (err as Error).message,
        });
        opts.logger.incrementCanonical(opts.ctx, "prisma.connection_retries", 1);
      }
      await sleep(delayMs);
    }
  }
}

/**
 * Builds the `$allOperations` hook with the logger/ctx baked in. Exported
 * so it can be unit-tested in isolation from `Prisma.defineExtension`,
 * which at runtime returns an opaque function that hides the hook.
 */
export function createAllOperationsHandler(logger: ILogger, bootCtx: AppContext) {
  return async <T>({
    args,
    query,
    operation,
    model,
  }: {
    args: unknown;
    query: (args: unknown) => Promise<T>;
    operation: string;
    model?: string;
  }): Promise<T> => {
    return retryOnConnectionError(() => query(args), {
      logger,
      ctx: bootCtx,
      operation,
      model,
    });
  };
}

/**
 * Prisma Client extension that transparently retries every query on
 * connection-level errors (EMAXCONN, too many clients, ECONNRESET, ...).
 *
 * Coverage:
 *   - Every operation that goes through `prisma.*.findX / create / update /
 *     delete / upsert / ...` — wherever in the codebase it's called from
 *     (apiKeyAuth, idempotency store, repos, read stores).
 *   - Operations inside `prisma.$transaction(async (tx) => ...)` — the `tx`
 *     client inherits the extension, so each query within a transaction is
 *     individually guarded.
 *
 * Non-coverage:
 *   - A connection that drops MID-transaction after BEGIN is not recoverable
 *     here — the transaction is already in progress on a dead socket, and
 *     Postgres/PgBouncer will roll it back. In practice this is extremely
 *     rare because pool exhaustion surfaces on the very first query of a
 *     cold invocation, and the retry resolves it before the transaction
 *     opens.
 *
 * Non-connection errors (VERSION_CONFLICT, ErrWalletNotFound, validation,
 * unique constraint violations) pass through unchanged. Higher layers keep
 * ownership of their concerns: TransactionManager retries on optimistic-lock
 * conflict, use cases translate domain errors to HTTP.
 */
export function connectionRetryExtension(logger: ILogger, bootCtx: AppContext) {
  const handler = createAllOperationsHandler(logger, bootCtx);
  return Prisma.defineExtension({
    name: "connection-retry",
    query: {
      $allOperations: handler,
    },
  });
}
