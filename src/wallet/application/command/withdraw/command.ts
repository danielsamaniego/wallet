export interface WithdrawCommand {
  walletId: string;
  platformId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface WithdrawResult {
  transactionId: string;
  movementId: string;
}
