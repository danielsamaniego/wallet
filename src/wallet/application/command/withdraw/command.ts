import { ICommand } from "../../../../utils/application/cqrs.js";

export interface WithdrawResult {
  transactionId: string;
  movementId: string;
}

export class WithdrawCommand extends ICommand<WithdrawResult> {
  static readonly TYPE = "Withdraw";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) { super(WithdrawCommand.TYPE); }
}
