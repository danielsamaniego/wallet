import { ICommand } from "../../../../shared/application/cqrs.js";

export interface ExpireHoldsResult {
  expiredCount: number;
}

export class ExpireHoldsCommand extends ICommand<ExpireHoldsResult> {
  static readonly TYPE = "ExpireHolds";
  constructor() { super(ExpireHoldsCommand.TYPE); }
}
