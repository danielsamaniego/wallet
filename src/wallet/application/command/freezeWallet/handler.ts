import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { FreezeWalletCommand } from "./command.js";

const mainLogTag = "FreezeWalletHandler";

export class FreezeWalletHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: FreezeWalletCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { wallet_id: cmd.walletId });

    await this.txManager.run(ctx, async (txCtx) => {
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(cmd.walletId);
      }
      if (wallet.platformId !== cmd.platformId) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      const now = Date.now();
      wallet.freeze(now);
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet frozen`, { wallet_id: cmd.walletId });
  }
}
