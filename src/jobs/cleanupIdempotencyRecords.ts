import type { PrismaClient } from "@prisma/client";
import { createAppContext } from "../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../shared/domain/observability/logger.port.js";

const logTag = "CleanupIdempotencyJob";

/**
 * Batch job that deletes expired idempotency records (expires_at < now).
 * Without cleanup, the idempotency_records table grows indefinitely.
 * Records have a 48h TTL set at creation time.
 */
export function startCleanupIdempotencyJob(
  prisma: PrismaClient,
  logger: ILogger,
  idGen: IIDGenerator,
  intervalMs: number = 60_000,
): NodeJS.Timeout {
  const run = async () => {
    const ctx = createAppContext(idGen);
    try {
      const now = BigInt(Date.now());
      const result = await prisma.idempotencyRecord.deleteMany({
        where: { expiresAt: { lt: now } },
      });

      if (result.count > 0) {
        logger.info(ctx, `${logTag} | deleted ${result.count} expired records`);
      }
    } catch (err) {
      logger.error(ctx, `${logTag} | failed`, {
        error: (err as Error).message,
      });
    }
  };

  run();
  return setInterval(run, intervalMs);
}
