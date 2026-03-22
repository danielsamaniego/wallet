import { ICommand } from "../../../../shared/application/cqrs.js";

export interface TransferResult {
  sourceTransactionId: string;
  targetTransactionId: string;
  movementId: string;
}

export class TransferCommand extends ICommand<TransferResult> {
  constructor(
    public readonly sourceWalletId: string,
    public readonly targetWalletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
  ) { super(); }
}
