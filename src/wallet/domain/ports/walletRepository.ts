import type { Wallet } from "../wallet/aggregate.js";

export interface WalletRepository {
  save(wallet: Wallet): Promise<void>;
  findById(walletId: string): Promise<Wallet | null>;
  findByOwner(ownerId: string, platformId: string, currencyCode: string): Promise<Wallet | null>;
  findSystemWallet(platformId: string, currencyCode: string): Promise<Wallet | null>;
  existsByOwner(ownerId: string, platformId: string, currencyCode: string): Promise<boolean>;
}
