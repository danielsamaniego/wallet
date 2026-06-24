import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IStatementReadStore } from "../../ports/statement.readstore.js";
import type { GetMovementStatementQuery, GlobalStatementEntryDTO } from "./query.js";

const mainLogTag = "GetMovementStatementUseCase";

export class GetMovementStatementUseCase
  implements IQueryHandler<GetMovementStatementQuery, GlobalStatementEntryDTO[]>
{
  constructor(
    private readonly readStore: IStatementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    query: GetMovementStatementQuery,
  ): Promise<GlobalStatementEntryDTO[]> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { movement_id: query.movementId });

    const entries = await this.readStore.getByMovement(ctx, query.movementId, query.platformId);

    // No user-facing face for this id in the platform → 404 (a system-only id,
    // a foreign platform's movement, or a non-existent id all land here).
    if (entries.length === 0) {
      this.logger.warn(ctx, `${methodLogTag} movement not found`, {
        movement_id: query.movementId,
      });
      throw AppError.notFound("MOVEMENT_NOT_FOUND", `movement ${query.movementId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      movement_id: query.movementId,
      faces: entries.length,
    });

    return entries;
  }
}
