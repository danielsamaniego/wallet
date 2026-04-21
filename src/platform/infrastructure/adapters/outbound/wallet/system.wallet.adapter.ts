import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { IWalletRepository } from "../../../../../wallet/domain/ports/wallet.repository.js";
import type { ISystemWalletPort } from "../../../../domain/ports/system.wallet.port.js";

export class SystemWalletAdapter implements ISystemWalletPort {
  constructor(private readonly walletRepo: IWalletRepository) {}

  listCurrencies(ctx: AppContext, platformId: string): Promise<string[]> {
    return this.walletRepo.listSystemWalletCurrencies(ctx, platformId);
  }

  ensureShards(
    ctx: AppContext,
    platformId: string,
    currency: string,
    shardCount: number,
    now: number,
  ): Promise<void> {
    return this.walletRepo.ensureSystemWalletShards(ctx, platformId, currency, shardCount, now);
  }
}
