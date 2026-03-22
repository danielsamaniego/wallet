import type { AppContext } from "../../../../shared/kernel/context.js";
import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { ILogger } from "../../../../shared/kernel/observability/logger.port.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ITransactionManager } from "../../../../shared/application/transaction.manager.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { CloseWalletCommand } from "./command.js";

const mainLogTag = "CloseWalletUseCase";

export class CloseWalletUseCase implements ICommandHandler<CloseWalletCommand, void> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: CloseWalletCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { wallet_id: cmd.walletId });

    await this.txManager.run(ctx, async (txCtx) => {
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: cmd.walletId });
        throw ErrWalletNotFound(cmd.walletId);
      }
      if (wallet.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} platform mismatch`, {
          wallet_id: cmd.walletId,
          expected_platform_id: cmd.platformId,
          actual_platform_id: wallet.platformId,
        });
        throw ErrWalletNotFound(cmd.walletId);
      }

      const now = Date.now();
      const activeHoldsCount = await this.holdRepo.countActiveHolds(txCtx, wallet.id);

      this.logger.debug(txCtx, `${methodLogTag} close pre-check`, {
        wallet_id: wallet.id,
        active_holds_count: activeHoldsCount,
        balance_cents: Number(wallet.cachedBalanceCents),
      });

      wallet.close(activeHoldsCount, now);
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet closed`, { wallet_id: cmd.walletId });
  }
}
