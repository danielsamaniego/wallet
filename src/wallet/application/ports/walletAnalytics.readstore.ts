import type { AppContext } from "../../../utils/kernel/context.js";
import type { BalanceTimeSeriesResponseDTO } from "../query/getBalanceTimeseries/query.js";
import type { CashFlowSummaryDTO } from "../query/getCashFlow/query.js";

export interface IWalletAnalyticsReadStore {
  /**
   * Sum of credits (income) vs debits (expense) over [fromMs, toMs] for the
   * wallet. Returns null if the wallet does not exist for the platform.
   */
  getCashFlow(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    fromMs: number,
    toMs: number,
  ): Promise<CashFlowSummaryDTO | null>;

  /**
   * End-of-day balance per UTC day over [fromMs, toMs] (carry-forward).
   * Returns null if the wallet does not exist for the platform.
   */
  getBalanceTimeseries(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    fromMs: number,
    toMs: number,
  ): Promise<BalanceTimeSeriesResponseDTO | null>;
}
