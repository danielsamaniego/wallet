import type { PrismaClient } from "@prisma/client";
import { createAppContext } from "../shared/kernel/context.js";
import type { IIDGenerator } from "../shared/application/id.generator.js";
import type { ILogger } from "../shared/kernel/observability/logger.port.js";

const logTag = "ExpireHoldsJob";

/**
 * Batch job that marks expired holds as 'expired'.
 * Holds with status='active' and expires_at < now are zombies —
 * they expired by time but no on-access detection has cleaned them up.
 *
 * The query filter in sumActiveHolds already excludes these (defense in depth),
 * but this job keeps the DB state consistent and prevents table bloat.
 */
export function startExpireHoldsJob(
  prisma: PrismaClient,
  logger: ILogger,
  idGen: IIDGenerator,
  intervalMs: number = 30_000,
): NodeJS.Timeout {
  const run = async () => {
    const ctx = createAppContext(idGen);
    try {
      const now = BigInt(Date.now());
      const result = await prisma.hold.updateMany({
        where: {
          status: "active",
          expiresAt: { not: null, lt: now },
        },
        data: {
          status: "expired",
          updatedAt: now,
        },
      });

      if (result.count > 0) {
        logger.info(ctx, `${logTag} | expired ${result.count} holds`);
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
