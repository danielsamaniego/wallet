import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletAnalyticsReadStore } from "../../ports/walletAnalytics.readstore.js";
import type { CashFlowSummaryDTO, GetCashFlowQuery } from "./query.js";

const mainLogTag = "GetCashFlowUseCase";

export class GetCashFlowUseCase implements IQueryHandler<GetCashFlowQuery, CashFlowSummaryDTO> {
  constructor(
    private readonly readStore: IWalletAnalyticsReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetCashFlowQuery): Promise<CashFlowSummaryDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      from_ms: query.fromMs,
      to_ms: query.toMs,
    });

    const result = await this.readStore.getCashFlow(
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
      days: result.days,
    });

    return result;
  }
}
