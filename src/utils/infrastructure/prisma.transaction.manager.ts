import type { PrismaClient } from "@prisma/client";
import type { ITransactionManager } from "../application/transaction.manager.js";
import { AppError } from "../kernel/appError.js";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";

const mainLogTag = "PrismaTransactionManager";

/** Max internal retries on retryable errors before escalating to client. */
const MAX_RETRIES = 5;

/**
 * Base delay in ms for the exponential backoff ceiling between retries.
 * Actual delay uses "full jitter": uniform random in [1, BASE * 2^(n-1)] ms.
 * Per-attempt ceiling: 30, 60, 120, 240 ms.
 *
 * Jitter desynchronises waves of losing transactions that would otherwise
 * retry at the same clock tick and collide again.
 */
const BASE_DELAY_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number): number {
  const ceiling = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.floor(Math.random() * ceiling) + 1;
}

/**
 * Checks if an error is retryable:
 * - VERSION_CONFLICT: our domain-level optimistic locking error.
 * - PostgreSQL serialization failure (40001 / P2034): thrown under
 *   Serializable isolation when PostgreSQL detects a read/write
 *   dependency conflict between concurrent transactions.
 * - Prisma's `TransactionWriteConflict` class: thrown when the query engine
 *   detects a write/write conflict during the transaction (no code/message
 *   match — only `name`). Covers the same family as 40001 at the engine level.
 */
function isRetryable(err: unknown): boolean {
  // Our domain error for optimistic locking
  if (AppError.is(err) && err.code === "VERSION_CONFLICT") return true;

  // PostgreSQL serialization failure (Prisma surfaces it as P2034 or
  // wraps the underlying 40001 SQLSTATE in the error message). Prisma 7's
  // engine also throws errors whose `name` or `message` is literally
  // "TransactionWriteConflict" (depending on where in the call stack the
  // error is raised), so match both.
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    if (e.code === "P2034") return true;
    if (e.name === "TransactionWriteConflict") return true;
    const msg = typeof e.message === "string" ? e.message : "";
    if (msg.includes("TransactionWriteConflict")) return true;
    if (msg.includes("could not serialize access")) return true;
    if (msg.includes("write conflict")) return true;
  }

  return false;
}

export class PrismaTransactionManager implements ITransactionManager {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async run<T>(ctx: AppContext, fn: (txCtx: AppContext) => Promise<T>): Promise<T> {
    const methodLogTag = `${mainLogTag} | run`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(ctx, `${methodLogTag} begin`, { attempt });

        const result = await this.prisma.$transaction(
          async (tx) => {
            return fn({ ...ctx, opCtx: tx });
          },
          { isolationLevel: "Serializable" },
        );

        this.logger.debug(ctx, `${methodLogTag} commit`);
        return result;
      } catch (err) {
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          const delayMs = retryDelayMs(attempt);
          this.logger.info(ctx, `${methodLogTag} retryable conflict, retrying internally`, {
            attempt,
            max_retries: MAX_RETRIES,
            delay_ms: delayMs,
            reason: AppError.is(err) ? err.code : "serialization_failure",
          });
          await sleep(delayMs);
          continue;
        }

        this.logger.debug(ctx, `${methodLogTag} rollback`, {
          attempt,
          error: err instanceof Error ? err.message : "unknown",
        });

        // If all retries exhausted on a serialization failure, wrap it as
        // a VERSION_CONFLICT so the HTTP layer returns 409 (retryable by
        // client) instead of 500.
        if (isRetryable(err) && !AppError.is(err)) {
          this.logger.warn(
            ctx,
            `${methodLogTag} retries exhausted, escalating as VERSION_CONFLICT`,
            {
              attempt,
              max_retries: MAX_RETRIES,
            },
          );
          throw AppError.conflict(
            "VERSION_CONFLICT",
            "transaction could not be serialized after multiple retries; retry with same idempotency key",
          );
        }
        throw err;
      }
    }

    // Unreachable — the loop always returns or throws.
    throw AppError.internal("TX_RETRY_EXHAUSTED", "transaction retry loop exited unexpectedly");
  }
}
