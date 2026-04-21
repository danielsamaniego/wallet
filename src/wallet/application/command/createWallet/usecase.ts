import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Wallet } from "../../../domain/wallet/wallet.aggregate.js";
import { ErrWalletAlreadyExists } from "../../../domain/wallet/wallet.errors.js";
import type { CreateWalletCommand, CreateWalletResult } from "./command.js";

const mainLogTag = "CreateWalletUseCase";

export class CreateWalletUseCase
  implements ICommandHandler<CreateWalletCommand, CreateWalletResult>
{
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

    // Materialize shards OUTSIDE the SERIALIZABLE tx: concurrent createWallet
    // requests for the same (platform, currency) would otherwise create
    // read-write dependencies on the shard rows and abort each other.
    // Idempotent via INSERT ... ON CONFLICT DO NOTHING.
    await this.walletRepo.ensureSystemWalletShards(
      ctx,
      cmd.platformId,
      cmd.currencyCode,
      cmd.systemWalletShardCount,
      now,
    );

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

      const wallet = Wallet.create(walletId, cmd.ownerId, cmd.platformId, cmd.currencyCode, now);
      await this.walletRepo.save(txCtx, wallet);
    });

    this.logger.info(ctx, `${methodLogTag} wallet created`, {
      wallet_id: walletId,
      currency_code: cmd.currencyCode,
      owner_id: cmd.ownerId,
    });

    return { walletId };
  }
}
