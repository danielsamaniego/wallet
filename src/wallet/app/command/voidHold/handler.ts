import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { ErrHoldNotFound } from "../../../domain/hold/errors.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";

export interface VoidHoldCommand {
  holdId: string;
}

const mainLogTag = "VoidHoldHandler";

export class VoidHoldHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: VoidHoldCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    await this.uow.run(async (repos) => {
      const hold = await repos.holds.findById(cmd.holdId);
      if (!hold) {
        throw ErrHoldNotFound(cmd.holdId);
      }

      const now = Date.now();

      // Check expiration on-access
      if (hold.isExpired(now)) {
        hold.expire(now);
        await repos.holds.save(hold);
        throw ErrHoldNotFound(cmd.holdId);
      }

      hold.void_(now);
      await repos.holds.save(hold);
    });

    this.logger.info(ctx, `${methodLogTag} hold voided`, { hold_id: cmd.holdId });
  }
}
