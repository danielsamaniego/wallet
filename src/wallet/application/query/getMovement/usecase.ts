import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IMovementReadStore } from "../../ports/movement.readstore.js";
import type { GetMovementQuery, MovementDTO } from "./query.js";

const mainLogTag = "GetMovementUseCase";

export class GetMovementUseCase implements IQueryHandler<GetMovementQuery, MovementDTO> {
  constructor(
    private readonly readStore: IMovementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetMovementQuery): Promise<MovementDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { movement_id: query.movementId });

    const dto = await this.readStore.getById(ctx, query.movementId, query.platformId);
    if (!dto) {
      this.logger.warn(ctx, `${methodLogTag} movement not found`, {
        movement_id: query.movementId,
      });
      throw AppError.notFound("MOVEMENT_NOT_FOUND", `movement ${query.movementId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      movement_id: query.movementId,
      status: dto.status,
    });

    return dto;
  }
}
