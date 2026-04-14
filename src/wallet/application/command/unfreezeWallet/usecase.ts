import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { UnfreezeWalletCommand } from "./command.js";

const mainLogTag = "UnfreezeWalletUseCase";

export class UnfreezeWalletUseCase implements ICommandHandler<UnfreezeWalletCommand, void> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: UnfreezeWalletCommand): Promise<void> {
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
      wallet.unfreeze(now);
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet unfrozen`, { wallet_id: cmd.walletId });
  }
}
