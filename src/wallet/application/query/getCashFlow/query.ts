import { IQuery } from "../../../../utils/application/cqrs.js";

export interface CashFlowSummaryDTO {
  income_minor: number | string;
  expense_minor: number | string;
  net_minor: number | string;
  days: number;
}

export class GetCashFlowQuery extends IQuery<CashFlowSummaryDTO> {
  static readonly TYPE = "GetCashFlow";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly fromMs: number,
    public readonly toMs: number,
  ) {
    super(GetCashFlowQuery.TYPE);
  }
}
