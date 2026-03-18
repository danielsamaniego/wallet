import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface CloseWalletCommand {
  walletId: string;
}

const mainLogTag = "CloseWalletHandler";

export class CloseWalletHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: CloseWalletCommand): Promise<void> {
    const methodLogTag = `${mainLogTag} | handle`;

    await this.uow.run(async (repos) => {
      const wallet = await repos.wallets.findById(cmd.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      const now = Date.now();
      const activeHoldsCount = await repos.holds.countActiveHolds(wallet.id);
      wallet.close(activeHoldsCount, now);
      await repos.wallets.save(wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet closed`, { wallet_id: cmd.walletId });
  }
}
