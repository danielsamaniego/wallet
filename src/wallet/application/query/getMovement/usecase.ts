import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletMovementReadStore } from "../../ports/walletMovement.readstore.js";
import type { WalletMovementDTO } from "../getWalletMovements/query.js";
import type { GetMovementQuery } from "./query.js";

const mainLogTag = "GetMovementUseCase";

export class GetMovementUseCase implements IQueryHandler<GetMovementQuery, WalletMovementDTO> {
  constructor(
    private readonly readStore: IWalletMovementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetMovementQuery): Promise<WalletMovementDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      movement_id: query.movementId,
    });

    const result = await this.readStore.getOne(
      ctx,
      query.walletId,
      query.movementId,
      query.platformId,
    );

    if (!result) {
      this.logger.warn(ctx, `${methodLogTag} movement not found`, {
        wallet_id: query.walletId,
        movement_id: query.movementId,
      });
      throw AppError.notFound(
        "MOVEMENT_NOT_FOUND",
        `movement ${query.movementId} not found for wallet ${query.walletId}`,
      );
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      movement_id: query.movementId,
      transaction_id: result.transaction_id,
    });

    return result;
  }
}
