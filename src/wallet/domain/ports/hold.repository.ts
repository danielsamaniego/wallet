import type { AppContext } from "../../../utils/kernel/context.js";
import type { Hold, HoldStatus } from "../hold/hold.entity.js";

export interface IHoldRepository {
  save(ctx: AppContext, hold: Hold): Promise<void>;
  /**
   * Conditional status transition: updates hold status only if the current DB status
   * matches `fromStatus`. Throws ErrHoldStatusChanged if the hold was modified
   * concurrently (e.g., expired by the scheduled job while a capture was in flight).
   */
  transitionStatus(
    ctx: AppContext,
    holdId: string,
    fromStatus: HoldStatus,
    toStatus: HoldStatus,
    now: number,
  ): Promise<void>;
  findById(ctx: AppContext, holdId: string): Promise<Hold | null>;
  findActiveByWallet(ctx: AppContext, walletId: string): Promise<Hold[]>;
  sumActiveHolds(ctx: AppContext, walletId: string): Promise<bigint>;
  countActiveHolds(ctx: AppContext, walletId: string): Promise<number>;
  /** Mark all holds past their expiresAt as 'expired'. Returns count of affected rows. */
  expireOverdue(ctx: AppContext): Promise<number>;
}
