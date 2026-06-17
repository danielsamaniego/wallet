import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import { dayCountInclusive } from "../../../../utils/kernel/day.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletAnalyticsReadStore } from "../../ports/walletAnalytics.readstore.js";
import type { BalanceTimeSeriesResponseDTO, GetBalanceTimeseriesQuery } from "./query.js";

const mainLogTag = "GetBalanceTimeseriesUseCase";

// A daily series longer than this would emit thousands of points and scan a
// large slice of the ledger; bound it so a single read can't degrade the DB.
const MAX_DAYS = 366;

export class GetBalanceTimeseriesUseCase
  implements IQueryHandler<GetBalanceTimeseriesQuery, BalanceTimeSeriesResponseDTO>
{
  constructor(
    private readonly readStore: IWalletAnalyticsReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    query: GetBalanceTimeseriesQuery,
  ): Promise<BalanceTimeSeriesResponseDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      from_ms: query.fromMs,
      to_ms: query.toMs,
    });

    const days = dayCountInclusive(query.fromMs, query.toMs);
    if (days > MAX_DAYS) {
      this.logger.warn(ctx, `${methodLogTag} range too large`, {
        wallet_id: query.walletId,
        days,
        max_days: MAX_DAYS,
      });
      throw AppError.validation(
        "RANGE_TOO_LARGE",
        `balance timeseries range must not exceed ${MAX_DAYS} days`,
      );
    }

    const result = await this.readStore.getBalanceTimeseries(
      ctx,
      query.walletId,
      query.platformId,
      query.fromMs,
      query.toMs,
    );

    if (!result) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      points: result.points.length,
    });

    return result;
  }
}
