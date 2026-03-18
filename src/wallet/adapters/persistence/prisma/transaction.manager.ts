import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";

const mainLogTag = "PrismaTransactionManager";

export class PrismaTransactionManager implements ITransactionManager {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async run<T>(ctx: AppContext, fn: (txCtx: AppContext) => Promise<T>): Promise<T> {
    const methodLogTag = `${mainLogTag} | run`;
    this.logger.debug(ctx, `${methodLogTag} begin`);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        return fn({ ...ctx, opCtx: tx });
      });
      this.logger.debug(ctx, `${methodLogTag} commit`);
      return result;
    } catch (err) {
      this.logger.debug(ctx, `${methodLogTag} rollback`, {
        error: err instanceof Error ? err.message : "unknown",
      });
      throw err;
    }
  }
}
