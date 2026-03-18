import type { Hold } from "../hold/entity.js";

export interface HoldRepository {
  save(hold: Hold): Promise<void>;
  findById(holdId: string): Promise<Hold | null>;
  findActiveByWallet(walletId: string): Promise<Hold[]>;
  sumActiveHolds(walletId: string): Promise<bigint>;
  countActiveHolds(walletId: string): Promise<number>;
}
