export interface CreateWalletCommand {
  ownerId: string;
  platformId: string;
  currencyCode: string;
}

export interface CreateWalletResult {
  walletId: string;
}
