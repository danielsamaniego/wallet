import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import type { VoidHoldCommand } from "./command.js";

const mainLogTag = "VoidHoldHandler";

export class VoidHoldHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: VoidHoldCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    await this.txManager.run(ctx, async (txCtx) => {
      const hold = await this.holdRepo.findById(txCtx, cmd.holdId);
      if (!hold) {
        this.logger.warn(txCtx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
        throw ErrHoldNotFound(cmd.holdId);
      }

      const wallet = await this.walletRepo.findById(txCtx, hold.walletId);
      if (!wallet || wallet.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found or platform mismatch`, {
          hold_id: cmd.holdId,
          wallet_id: hold.walletId,
          platform_id: cmd.platformId,
        });
        throw ErrHoldNotFound(cmd.holdId);
      }

      const now = Date.now();

      // Check expiration on-access
      if (hold.isExpired(now)) {
        this.logger.info(txCtx, `${methodLogTag} hold expired on access`, {
          hold_id: hold.id,
          wallet_id: hold.walletId,
          expires_at: hold.expiresAt,
        });
        hold.expire(now);
        await this.holdRepo.save(txCtx, hold);
        throw ErrHoldExpired(cmd.holdId);
      }

      hold.void_(now);

      // Participate in optimistic locking so concurrent VoidHold/CaptureHold
      // on the same wallet contend for the version and only one wins.
      wallet.touchForHoldChange(now); // Just update the updatedAt timestamp.

      await this.walletRepo.save(txCtx, wallet); // If version mismatch, the save will fail with VERSION_CONFLICT.
      await this.holdRepo.save(txCtx, hold);
    });

    this.logger.info(ctx, `${methodLogTag} hold voided`, { hold_id: cmd.holdId });
  }
}
