import { ICommand } from "../../../../utils/application/cqrs.js";

export interface ChargeResult {
  transactionId: string;
  movementId: string;
}

export class ChargeCommand extends ICommand<ChargeResult> {
  static readonly TYPE = "Charge";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountMinor: bigint,
    public readonly idempotencyKey: string,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(ChargeCommand.TYPE);
  }
}
