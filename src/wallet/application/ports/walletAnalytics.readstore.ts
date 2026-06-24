import type { AppContext } from "../../../utils/kernel/context.js";
import type { BalanceTimeSeriesResponseDTO } from "../query/getBalanceTimeseries/query.js";
import type { CashFlowSummaryDTO } from "../query/getCashFlow/query.js";

/**
 * Dimension a movement breakdown is grouped by. `metadata` groups by an
 * arbitrary consumer-supplied JSON key (see `metadataKey`) so the service stays
 * agnostic of any consumer concept; `owner` is only meaningful platform-wide.
 */
export type MovementGroupBy = "type" | "day" | "week" | "month" | "metadata" | "owner";

/** Which ledger entries to include in the breakdown. */
export type MovementDirection = "credit" | "debit" | "all";

/**
 * Scope + shaping of a movement breakdown. `walletId` restricts to a single
 * wallet (per-wallet endpoint); `ownerId` narrows a platform-wide query to one
 * owner. Both omitted → the whole platform. `metadataKey` is required when
 * `groupBy === "metadata"`.
 */
export interface MovementBreakdownParams {
  platformId: string;
  fromMs: number;
  toMs: number;
  groupBy: MovementGroupBy;
  direction: MovementDirection;
  walletId?: string;
  ownerId?: string;
  metadataKey?: string;
}

/** One aggregated bucket of a movement breakdown. Amounts in minor units. */
export interface MovementBreakdownBucketDTO {
  /** The group value: type, "YYYY-MM"/"YYYY-Www"/"YYYY-MM-DD", metadata value, or owner_id. Null when the grouped field is absent. */
  bucket: string | null;
  sum_net_minor: number | string;
  sum_credits_minor: number | string;
  sum_debits_minor: number | string;
  count: number;
}

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

  /**
   * Aggregated movement breakdown (signed credit/debit/net sums + count) grouped
   * by `params.groupBy` over [fromMs, toMs], summing the wallet's own ledger
   * entries. Scope is always bounded to `params.platformId`. Returns null only
   * when `params.walletId` is set and that wallet does not exist for the
   * platform (per-wallet 404); platform-wide queries always return an array
   * (possibly empty).
   */
  aggregateMovements(
    ctx: AppContext,
    params: MovementBreakdownParams,
  ): Promise<MovementBreakdownBucketDTO[] | null>;
}
