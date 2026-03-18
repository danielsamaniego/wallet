export interface TransferCommand {
  sourceWalletId: string;
  targetWalletId: string;
  platformId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface TransferResult {
  sourceTransactionId: string;
  targetTransactionId: string;
}
