export interface DepositCommand {
  walletId: string;
  platformId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface DepositResult {
  transactionId: string;
}
