export interface PlaceHoldCommand {
  walletId: string;
  platformId: string;
  amountCents: bigint;
  reference?: string;
  expiresAt?: number;
}

export interface PlaceHoldResult {
  holdId: string;
}
