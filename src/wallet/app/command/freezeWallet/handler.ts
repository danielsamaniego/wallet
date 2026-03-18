import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface FreezeWalletCommand {
  walletId: string;
}

const mainLogTag = "FreezeWalletHandler";

export class FreezeWalletHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: FreezeWalletCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    await this.uow.run(async (repos) => {
      const wallet = await repos.wallets.findById(cmd.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      const now = Date.now();
      wallet.freeze(now);
      await repos.wallets.save(wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet frozen`, { wallet_id: cmd.walletId });
  }
}
