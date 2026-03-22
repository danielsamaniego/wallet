import { ICommand } from "../../../../shared/application/cqrs.js";

export interface CaptureHoldResult {
  transactionId: string;
  movementId: string;
}

export class CaptureHoldCommand extends ICommand<CaptureHoldResult> {
  static readonly TYPE = "CaptureHold";
  constructor(
    public readonly holdId: string,
    public readonly platformId: string,
    public readonly idempotencyKey: string,
  ) { super(CaptureHoldCommand.TYPE); }
}
