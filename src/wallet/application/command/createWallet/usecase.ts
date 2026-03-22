import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { ITransactionManager } from "../../../../shared/domain/kernel/transaction.manager.js";
import type { ICreateWalletUseCase } from "../../ports/inbound/create-wallet.usecase.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Wallet } from "../../../domain/wallet/wallet.aggregate.js";
import { ErrWalletAlreadyExists } from "../../../domain/wallet/wallet.errors.js";
import type { CreateWalletCommand, CreateWalletResult } from "./command.js";

const mainLogTag = "CreateWalletUseCase";

export class CreateWalletUseCase implements ICreateWalletUseCase {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: CreateWalletCommand): Promise<CreateWalletResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      owner_id: cmd.ownerId,
      currency_code: cmd.currencyCode,
    });

    const walletId = this.idGen.newId();
    const now = Date.now();

    await this.txManager.run(ctx, async (txCtx) => {
      const exists = await this.walletRepo.existsByOwner(
        txCtx,
        cmd.ownerId,
        cmd.platformId,
        cmd.currencyCode,
      );
      if (exists) {
        this.logger.warn(txCtx, `${methodLogTag} wallet already exists for owner`, {
          owner_id: cmd.ownerId,
          platform_id: cmd.platformId,
          currency_code: cmd.currencyCode,
        });
        throw ErrWalletAlreadyExists();
      }

      // Ensure system wallet exists for this platform/currency
      const systemWallet = await this.walletRepo.findSystemWallet(
        txCtx,
        cmd.platformId,
        cmd.currencyCode,
      );
      if (!systemWallet) {
        const sysId = this.idGen.newId();
        const sys = Wallet.create(sysId, "SYSTEM", cmd.platformId, cmd.currencyCode, true, now);
        await this.walletRepo.save(txCtx, sys);
        this.logger.info(txCtx, `${methodLogTag} system wallet created`, {
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
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet created`, {
      wallet_id: walletId,
      owner_id: cmd.ownerId,
    });

    return { walletId };
  }
}
