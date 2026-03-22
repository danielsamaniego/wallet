import type { AppContext } from "../../../shared/kernel/context.js";
import type { Wallet } from "../wallet/wallet.aggregate.js";

export interface IWalletRepository {
  save(ctx: AppContext, wallet: Wallet): Promise<void>;
  /**
   * Atomically adjust a system wallet's balance by a delta.
   * Uses a single UPDATE with increment/decrement — no version check needed
   * because system wallets have no balance constraints or business logic
   * that depends on reading the balance first.
   * This eliminates contention on the system wallet hot row.
   */
  adjustSystemWalletBalance(
    ctx: AppContext,
    walletId: string,
    deltaCents: bigint,
    now: number,
  ): Promise<void>;
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
