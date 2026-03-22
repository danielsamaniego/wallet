import { AppError } from "../../../../utils/kernel/appError.js";
import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { GetHoldQuery, HoldDTO } from "./query.js";
import type { IHoldReadStore } from "../../ports/hold.readstore.js";

const mainLogTag = "GetHoldUseCase";

export class GetHoldUseCase implements IQueryHandler<GetHoldQuery, HoldDTO> {
  constructor(
    private readonly readStore: IHoldReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetHoldQuery): Promise<HoldDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: query.holdId });

    const dto = await this.readStore.getById(ctx, query.holdId, query.platformId);
    if (!dto) {
      this.logger.warn(ctx, `${methodLogTag} hold not found`, { hold_id: query.holdId });
      throw AppError.notFound("HOLD_NOT_FOUND", `hold ${query.holdId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      hold_id: query.holdId,
      status: dto.status,
    });

    return dto;
  }
}
