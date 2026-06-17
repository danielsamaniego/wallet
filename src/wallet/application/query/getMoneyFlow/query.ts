import { IQuery } from "../../../../utils/application/cqrs.js";

export interface MoneyFlowSummaryDTO {
  income_minor: number | string;
  expense_minor: number | string;
  net_minor: number | string;
  days: number;
}

export class GetMoneyFlowQuery extends IQuery<MoneyFlowSummaryDTO> {
  static readonly TYPE = "GetMoneyFlow";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly fromMs: number,
    public readonly toMs: number,
  ) {
    super(GetMoneyFlowQuery.TYPE);
  }
}
