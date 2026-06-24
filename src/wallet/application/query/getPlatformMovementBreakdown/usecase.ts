import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type {
  IWalletAnalyticsReadStore,
  MovementBreakdownBucketDTO,
} from "../../ports/walletAnalytics.readstore.js";
import type { GetPlatformMovementBreakdownQuery } from "./query.js";

const mainLogTag = "GetPlatformMovementBreakdownUseCase";

export class GetPlatformMovementBreakdownUseCase
  implements IQueryHandler<GetPlatformMovementBreakdownQuery, MovementBreakdownBucketDTO[]>
{
  constructor(
    private readonly readStore: IWalletAnalyticsReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    query: GetPlatformMovementBreakdownQuery,
  ): Promise<MovementBreakdownBucketDTO[]> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: query.platformId,
      group_by: query.groupBy,
      from_ms: query.fromMs,
      to_ms: query.toMs,
      owner_id: query.ownerId,
    });

    // Platform scope: no per-wallet existence check, so the read store never
    // returns null here; an empty range simply yields an empty array.
    const result =
      (await this.readStore.aggregateMovements(ctx, {
        platformId: query.platformId,
        fromMs: query.fromMs,
        toMs: query.toMs,
        groupBy: query.groupBy,
        direction: query.direction,
        metadataKey: query.metadataKey,
        ownerId: query.ownerId,
      })) ?? [];

    this.logger.info(ctx, `${methodLogTag} success`, {
      platform_id: query.platformId,
      buckets: result.length,
    });

    return result;
  }
}
