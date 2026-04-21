import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import type { VoidHoldCommand } from "./command.js";

const mainLogTag = "VoidHoldUseCase";

export class VoidHoldUseCase implements ICommandHandler<VoidHoldCommand, void> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
  ) {}

  async handle(ctx: AppContext, cmd: VoidHoldCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    const holdForKey = await this.holdRepo.findById(ctx, cmd.holdId);
    if (!holdForKey) {
      this.logger.warn(ctx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
      throw ErrHoldNotFound(cmd.holdId);
    }

    const walletForKey = await this.walletRepo.findById(ctx, holdForKey.walletId);
    if (!walletForKey || walletForKey.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} cross-tenant pre-lock rejection`, {
        hold_id: cmd.holdId,
        wallet_id: holdForKey.walletId,
        expected_platform_id: cmd.platformId,
        actual_platform_id: walletForKey?.platformId,
      });
      throw ErrHoldNotFound(cmd.holdId);
    }

    let walletCurrency = "";

    await this.lockRunner.run(ctx, [`wallet-lock:${holdForKey.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const hold = await this.holdRepo.findById(txCtx, cmd.holdId);
        if (!hold) {
          this.logger.warn(txCtx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
          throw ErrHoldNotFound(cmd.holdId);
        }

        // Wallet re-read inside the tx. Platform ownership was validated in
        // the pre-lock guard and platformId is immutable, so we only defend
        // against the wallet being deleted in the tiny window between
        // pre-lock and tx start (theoretical; no current API deletes wallets).
        const wallet = await this.walletRepo.findById(txCtx, hold.walletId);
        if (!wallet) {
          this.logger.warn(txCtx, `${methodLogTag} wallet disappeared after pre-lock`, {
            hold_id: cmd.holdId,
            wallet_id: hold.walletId,
          });
          throw ErrHoldNotFound(cmd.holdId);
        }
        walletCurrency = wallet.currencyCode;

        const now = Date.now();

        // Check expiration on-access
        if (hold.isExpired(now)) {
          this.logger.info(txCtx, `${methodLogTag} hold expired on access`, {
            hold_id: hold.id,
            wallet_id: hold.walletId,
            currency_code: wallet.currencyCode,
            expires_at: hold.expiresAt,
          });
          hold.expire(now);
          try {
            await this.holdRepo.transitionStatus(txCtx, hold.id, "active", "expired", now);
          } catch {
            /* already expired/changed by another process — that's fine */
          }
          throw ErrHoldExpired(cmd.holdId);
        }

        hold.void_(now);

        // Participate in optimistic locking so concurrent VoidHold/CaptureHold
        // on the same wallet contend for the version and only one wins.
        wallet.touchForHoldChange(now); // Just update the updatedAt timestamp.

        await this.walletRepo.save(txCtx, wallet); // If version mismatch, the save will fail with VERSION_CONFLICT.
        await this.holdRepo.transitionStatus(txCtx, hold.id, "active", "voided", now);
      });
    });

    this.logger.info(ctx, `${methodLogTag} hold voided`, {
      hold_id: cmd.holdId,
      currency_code: walletCurrency,
    });
  }
}
