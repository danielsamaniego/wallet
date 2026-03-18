import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { Wallet } from "../../../domain/wallet/aggregate.js";
import { ErrWalletAlreadyExists } from "../../../domain/wallet/errors.js";

export interface CreateWalletCommand {
  ownerId: string;
  platformId: string;
  currencyCode: string;
}

export interface CreateWalletResult {
  walletId: string;
}

const mainLogTag = "CreateWalletHandler";

export class CreateWalletHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: CreateWalletCommand): Promise<CreateWalletResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    const walletId = this.idGen.newId();
    const now = Date.now();

    await this.uow.run(async (repos) => {
      const exists = await repos.wallets.existsByOwner(
        cmd.ownerId,
        cmd.platformId,
        cmd.currencyCode,
      );
      if (exists) {
        throw ErrWalletAlreadyExists();
      }

      // Ensure system wallet exists for this platform/currency
      const systemWallet = await repos.wallets.findSystemWallet(cmd.platformId, cmd.currencyCode);
      if (!systemWallet) {
        const sysId = this.idGen.newId();
        const sys = Wallet.create(sysId, "SYSTEM", cmd.platformId, cmd.currencyCode, true, now);
        await repos.wallets.save(sys);
        this.logger.info(ctx, `${methodLogTag} system wallet created`, {
          system_wallet_id: sysId,
          platform_id: cmd.platformId,
          currency_code: cmd.currencyCode,
        });
      }

      const wallet = Wallet.create(
        walletId,
        cmd.ownerId,
        cmd.platformId,
        cmd.currencyCode,
        false,
        now,
      );
      await repos.wallets.save(wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet created`, {
      wallet_id: walletId,
      owner_id: cmd.ownerId,
    });

    return { walletId };
  }
}
