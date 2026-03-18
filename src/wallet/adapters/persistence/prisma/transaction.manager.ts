import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../../../shared/domain/appError.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";

const mainLogTag = "PrismaTransactionManager";

/** Max internal retries on VERSION_CONFLICT before escalating to client (409). */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff between retries (10ms, 20ms, 40ms…). */
const BASE_DELAY_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

        const result = await this.prisma.$transaction(async (tx) => {
          return fn({ ...ctx, opCtx: tx });
        });

        this.logger.debug(ctx, `${methodLogTag} commit`);
        return result;
      } catch (err) {
        const isConflict = AppError.is(err) && err.code === "VERSION_CONFLICT";

        if (isConflict && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1); // Exponential backoff.
          this.logger.info(ctx, `${methodLogTag} version conflict, retrying internally`, {
            attempt,
            max_retries: MAX_RETRIES,
            delay_ms: delayMs,
          });
          await sleep(delayMs);
          continue;
        }

        this.logger.debug(ctx, `${methodLogTag} rollback`, {
          attempt,
          error: err instanceof Error ? err.message : "unknown",
        });
        throw err;
      }
    }

    // Unreachable — the loop always returns or throws.
    throw AppError.internal("TX_RETRY_EXHAUSTED", "transaction retry loop exited unexpectedly");
  }
}
