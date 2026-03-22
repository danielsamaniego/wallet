import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { ITransactionManager } from "../../../../shared/domain/kernel/transaction.manager.js";
import type { IFreezeWalletUseCase } from "../../ports/inbound/freeze-wallet.usecase.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { FreezeWalletCommand } from "./command.js";

const mainLogTag = "FreezeWalletUseCase";

export class FreezeWalletUseCase implements IFreezeWalletUseCase {
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
      wallet.freeze(now);
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet frozen`, { wallet_id: cmd.walletId });
  }
}
