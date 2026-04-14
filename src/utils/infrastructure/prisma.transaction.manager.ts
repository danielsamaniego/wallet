import type { PrismaClient } from "@prisma/client";
import type { ITransactionManager } from "../application/transaction.manager.js";
import { AppError } from "../kernel/appError.js";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";

const mainLogTag = "PrismaTransactionManager";

/** Max internal retries on retryable errors before escalating to client. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff between retries (30ms, 60ms, 120ms). */
const BASE_DELAY_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if an error is retryable:
 * - VERSION_CONFLICT: our domain-level optimistic locking error.
 * - PostgreSQL serialization failure (40001 / P2034): thrown under
 *   Serializable isolation when PostgreSQL detects a read/write
 *   dependency conflict between concurrent transactions.
 */
function isRetryable(err: unknown): boolean {
  // Our domain error for optimistic locking
  if (AppError.is(err) && err.code === "VERSION_CONFLICT") return true;

  // PostgreSQL serialization failure (Prisma surfaces it as P2034 or
  // wraps the underlying 40001 SQLSTATE in the error message)
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    if (e.code === "P2034") return true;
    if (typeof e.message === "string" && e.message.includes("could not serialize access"))
      return true;
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
          const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1); // Exponential backoff.
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
