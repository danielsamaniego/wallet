import { ICommand } from "../../../../utils/application/cqrs.js";

export interface DepositResult {
  transactionId: string;
  movementId: string;
}

export class DepositCommand extends ICommand<DepositResult> {
  static readonly TYPE = "Deposit";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountMinor: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(DepositCommand.TYPE);
  }
}
