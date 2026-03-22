import { ICommand } from "../../../../shared/application/cqrs.js";

export interface WithdrawResult {
  transactionId: string;
  movementId: string;
}

export class WithdrawCommand extends ICommand<WithdrawResult> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
  ) { super(); }
}
