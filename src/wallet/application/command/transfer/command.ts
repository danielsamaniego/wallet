import { ICommand } from "../../../../utils/application/cqrs.js";

export interface TransferResult {
  sourceTransactionId: string;
  targetTransactionId: string;
  movementId: string;
}

export class TransferCommand extends ICommand<TransferResult> {
  static readonly TYPE = "Transfer";
  constructor(
    public readonly sourceWalletId: string,
    public readonly targetWalletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(TransferCommand.TYPE);
  }
}
