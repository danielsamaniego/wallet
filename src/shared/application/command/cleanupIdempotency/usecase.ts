import type { AppContext } from "../../../kernel/context.js";
import type { ICommandHandler } from "../../cqrs.js";
import type { ILogger } from "../../../kernel/observability/logger.port.js";
import type { IIdempotencyStore } from "../../../infrastructure/http/middleware/idempotency.js";
import type { CleanupIdempotencyCommand, CleanupIdempotencyResult } from "./command.js";

const mainLogTag = "CleanupIdempotencyUseCase";

export class CleanupIdempotencyUseCase
  implements ICommandHandler<CleanupIdempotencyCommand, CleanupIdempotencyResult>
{
  constructor(
    private readonly idempotencyStore: IIdempotencyStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, _cmd: CleanupIdempotencyCommand): Promise<CleanupIdempotencyResult> {
    const deletedCount = await this.idempotencyStore.deleteExpired();

    if (deletedCount > 0) {
      this.logger.info(ctx, `${mainLogTag} | deleted ${deletedCount} expired records`);
    }

    return { deletedCount };
  }
}
