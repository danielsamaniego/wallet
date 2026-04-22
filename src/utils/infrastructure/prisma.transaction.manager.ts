import type { PrismaClient } from "@prisma/client";
import type { ITransactionManager } from "../application/transaction.manager.js";
import { AppError } from "../kernel/appError.js";
import type { AppContext } from "../kernel/context.js";
import type { ILogger } from "../kernel/observability/logger.port.js";
import { isConnectionError } from "./connection.retry.extension.js";

const mainLogTag = "PrismaTransactionManager";

/** Max internal retries on retryable errors before escalating to client. */
const MAX_RETRIES = 5;

/**
 * Base delay in ms for exponential backoff ceiling on VERSION_CONFLICT /
 * serialization retries. Full-jitter: uniform random in [1, BASE * 2^(n-1)].
 * Per-attempt ceiling: 30, 60, 120, 240 ms.
 *
 * Tight schedule on purpose — these conflicts resolve fast once the losing
 * transactions desynchronise via jitter.
 */
const CONFLICT_BASE_DELAY_MS = 30;

/**
 * Backoff for connection-level errors on the `$transaction` boundary (e.g.
 * EMAXCONN when Prisma opens a fresh TCP to PgBouncer after discarding a
 * rolled-back connection). Exponential with cap:
 *
 *   Attempt 1 fail → sleep min(200,  cap) + j = ~250ms
 *   Attempt 2 fail → sleep min(400,  cap) + j = ~450ms
 *   Attempt 3 fail → sleep min(800,  cap) + j = ~850ms
 *   Attempt 4 fail → sleep min(1600, cap) + j = ~1650ms
 *   Attempt 5     → last attempt, throws on failure
 *
 * Total wait budget ~3.2s across 5 attempts, well within the 25s
 * `maxDuration` even combined with ~5s of actual transaction work.
 *
 * These delays are longer than the conflict backoff because connection
 * saturation at PgBouncer takes hundreds of ms (not tens) to drain as
 * other instances finish their transactions and release TCPs.
 */
const CONNECTION_BASE_DELAY_MS = 200;
const CONNECTION_MAX_DELAY_MS = 2000;
const CONNECTION_JITTER_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conflictDelayMs(attempt: number): number {
  const ceiling = CONFLICT_BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.floor(Math.random() * ceiling) + 1;
}

function connectionDelayMs(attempt: number): number {
  const expDelayMs = CONNECTION_BASE_DELAY_MS * 2 ** (attempt - 1);
  const cappedDelayMs = Math.min(expDelayMs, CONNECTION_MAX_DELAY_MS);
  return cappedDelayMs + Math.floor(Math.random() * CONNECTION_JITTER_MS);
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
        // Two retryable error families at the $transaction boundary:
        //
        //  1. Domain / serialization conflict (VERSION_CONFLICT, P2034, ...)
        //     — covered previously. Backoff is tight (30-240ms) because
        //     these clear as soon as concurrent txs desynchronise.
        //  2. Connection-level (EMAXCONN, too many clients, ECONNRESET, ...)
        //     — NEW. Surfaces when Prisma opens a fresh TCP for this tx
        //     attempt (e.g. because the previous rollback discarded the
        //     pooled connection) and PgBouncer is at its client-conn cap.
        //     `connection.retry.extension.ts` covers model operations but
        //     CANNOT cover `$transaction` itself, since BEGIN fails before
        //     any query hook fires. This layer closes that gap.
        //
        // Both use the same MAX_RETRIES budget so the worst case stays
        // bounded even when both error types alternate.
        const conflictRetryable = isRetryable(err);
        const connectionRetryable = isConnectionError(err);
        if ((conflictRetryable || connectionRetryable) && attempt < MAX_RETRIES) {
          const delayMs = connectionRetryable
            ? connectionDelayMs(attempt)
            : conflictDelayMs(attempt);
          const reason = connectionRetryable
            ? "connection_error"
            : AppError.is(err)
              ? err.code
              : "serialization_failure";
          this.logger.info(ctx, `${methodLogTag} retryable error, retrying internally`, {
            attempt,
            max_retries: MAX_RETRIES,
            delay_ms: delayMs,
            reason,
            error: err instanceof Error ? err.message : "unknown",
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
        if (conflictRetryable && !AppError.is(err)) {
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
