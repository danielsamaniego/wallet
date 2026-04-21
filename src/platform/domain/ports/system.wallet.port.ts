import type { AppContext } from "../../../utils/kernel/context.js";

export interface ISystemWalletPort {
  listCurrencies(ctx: AppContext, platformId: string): Promise<string[]>;
  ensureShards(
    ctx: AppContext,
    platformId: string,
    currency: string,
    shardCount: number,
    now: number,
  ): Promise<void>;
}
