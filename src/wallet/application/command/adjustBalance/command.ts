import { ICommand } from "../../../../utils/application/cqrs.js";

export interface AdjustBalanceResult {
  transactionId: string;
  movementId: string;
}

export class AdjustBalanceCommand extends ICommand<AdjustBalanceResult> {
  static readonly TYPE = "AdjustBalance";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountMinor: bigint,
    public readonly reason: string,
    public readonly idempotencyKey: string,
    public readonly allowNegativeBalance: boolean,
    public readonly systemWalletShardCount: number,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(AdjustBalanceCommand.TYPE);
  }
}
