import { ICommand } from "../../../../shared/application/cqrs.js";

export interface DepositResult {
  transactionId: string;
  movementId: string;
}

export class DepositCommand extends ICommand<DepositResult> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
  ) { super(); }
}
