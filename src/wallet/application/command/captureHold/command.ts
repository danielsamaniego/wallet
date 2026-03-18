export interface CaptureHoldCommand {
  holdId: string;
  platformId: string;
  idempotencyKey: string;
}

export interface CaptureHoldResult {
  transactionId: string;
  movementId: string;
}
