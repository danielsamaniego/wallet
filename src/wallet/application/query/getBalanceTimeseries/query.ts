import { IQuery } from "../../../../utils/application/cqrs.js";

export interface BalancePointDTO {
  /** UTC calendar day (YYYY-MM-DD). */
  date: string;
  /** End-of-day balance for the wallet (carry-forward). */
  balance_minor: number | string;
}

export interface BalanceTimeSeriesResponseDTO {
  points: BalancePointDTO[];
}

export class GetBalanceTimeseriesQuery extends IQuery<BalanceTimeSeriesResponseDTO> {
  static readonly TYPE = "GetBalanceTimeseries";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly fromMs: number,
    public readonly toMs: number,
  ) {
    super(GetBalanceTimeseriesQuery.TYPE);
  }
}
