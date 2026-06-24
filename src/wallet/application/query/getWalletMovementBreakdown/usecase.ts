import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type {
  IWalletAnalyticsReadStore,
  MovementBreakdownBucketDTO,
} from "../../ports/walletAnalytics.readstore.js";
import type { GetWalletMovementBreakdownQuery } from "./query.js";

const mainLogTag = "GetWalletMovementBreakdownUseCase";

export class GetWalletMovementBreakdownUseCase
  implements IQueryHandler<GetWalletMovementBreakdownQuery, MovementBreakdownBucketDTO[]>
{
  constructor(
    private readonly readStore: IWalletAnalyticsReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    query: GetWalletMovementBreakdownQuery,
  ): Promise<MovementBreakdownBucketDTO[]> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      group_by: query.groupBy,
      from_ms: query.fromMs,
      to_ms: query.toMs,
    });

    const result = await this.readStore.aggregateMovements(ctx, {
      platformId: query.platformId,
      walletId: query.walletId,
      fromMs: query.fromMs,
      toMs: query.toMs,
      groupBy: query.groupBy,
      direction: query.direction,
      metadataKey: query.metadataKey,
    });

    if (result === null) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      buckets: result.length,
    });

    return result;
  }
}
