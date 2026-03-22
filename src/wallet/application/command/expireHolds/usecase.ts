import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ExpireHoldsCommand, ExpireHoldsResult } from "./command.js";

const mainLogTag = "ExpireHoldsUseCase";

export class ExpireHoldsUseCase implements ICommandHandler<ExpireHoldsCommand, ExpireHoldsResult> {
  constructor(
    private readonly holdRepo: IHoldRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, _cmd: ExpireHoldsCommand): Promise<ExpireHoldsResult> {
    const expiredCount = await this.holdRepo.expireOverdue(ctx);

    if (expiredCount > 0) {
      this.logger.info(ctx, `${mainLogTag} | expired ${expiredCount} holds`);
    }

    return { expiredCount };
  }
}
