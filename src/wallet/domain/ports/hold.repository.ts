import type { AppContext } from "../../../shared/domain/kernel/context.js";
import type { Hold } from "../hold/hold.entity.js";

export interface IHoldRepository {
  save(ctx: AppContext, hold: Hold): Promise<void>;
  findById(ctx: AppContext, holdId: string): Promise<Hold | null>;
  findActiveByWallet(ctx: AppContext, walletId: string): Promise<Hold[]>;
  sumActiveHolds(ctx: AppContext, walletId: string): Promise<bigint>;
  countActiveHolds(ctx: AppContext, walletId: string): Promise<number>;
}
