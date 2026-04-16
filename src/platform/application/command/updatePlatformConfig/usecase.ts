import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { ErrPlatformNotFound } from "../../../domain/platform/platform.errors.js";
import type { IPlatformRepository } from "../../../domain/ports/platform.repository.js";
import type { UpdatePlatformConfigCommand, UpdatePlatformConfigResult } from "./command.js";

const mainLogTag = "UpdatePlatformConfigUseCase";

export class UpdatePlatformConfigUseCase
  implements ICommandHandler<UpdatePlatformConfigCommand, UpdatePlatformConfigResult>
{
  constructor(
    private readonly platformRepo: IPlatformRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    cmd: UpdatePlatformConfigCommand,
  ): Promise<UpdatePlatformConfigResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: cmd.platformId,
      allow_negative_balance: cmd.allowNegativeBalance,
    });

    const platform = await this.platformRepo.findById(ctx, cmd.platformId);
    if (!platform) {
      this.logger.warn(ctx, `${methodLogTag} platform not found`, { platform_id: cmd.platformId });
      throw ErrPlatformNotFound(cmd.platformId);
    }

    platform.setAllowNegativeBalance(cmd.allowNegativeBalance, Date.now());
    await this.platformRepo.save(ctx, platform);

    this.logger.info(ctx, `${methodLogTag} config updated`, {
      platform_id: cmd.platformId,
      allow_negative_balance: cmd.allowNegativeBalance,
    });

    return { platformId: cmd.platformId };
  }
}
