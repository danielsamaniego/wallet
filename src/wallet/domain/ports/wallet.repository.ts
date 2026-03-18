import type { AppContext } from "../../../shared/domain/kernel/context.js";
import type { Wallet } from "../wallet/wallet.aggregate.js";

export interface IWalletRepository {
  save(ctx: AppContext, wallet: Wallet): Promise<void>;
  findById(ctx: AppContext, walletId: string): Promise<Wallet | null>;
  findByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null>;
  findSystemWallet(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null>;
  existsByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<boolean>;
}
