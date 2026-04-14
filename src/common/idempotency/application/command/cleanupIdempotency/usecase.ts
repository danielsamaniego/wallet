import type { ICommandHandler } from "../../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IIdempotencyStore } from "../../ports/idempotency.store.js";
import type { CleanupIdempotencyCommand, CleanupIdempotencyResult } from "./command.js";

const mainLogTag = "CleanupIdempotencyUseCase";

export class CleanupIdempotencyUseCase
  implements ICommandHandler<CleanupIdempotencyCommand, CleanupIdempotencyResult>
{
  constructor(
    private readonly idempotencyStore: IIdempotencyStore,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    _cmd: CleanupIdempotencyCommand,
  ): Promise<CleanupIdempotencyResult> {
    const deletedCount = await this.idempotencyStore.deleteExpired(ctx);

    if (deletedCount > 0) {
      this.logger.info(ctx, `${mainLogTag} | deleted ${deletedCount} expired records`);
    }

    return { deletedCount };
  }
}
