import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Wallet } from "../../../domain/wallet/wallet.aggregate.js";
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

    // No SELECT-before-INSERT: the (owner, platform, currency, shard_index=0)
    // unique constraint on wallets rejects duplicates at the DB level. The
    // adapter catches Prisma's P2002 and throws ErrWalletAlreadyExists. A
    // pre-flight check would create predicate locks under SERIALIZABLE that
    // abort concurrent unrelated creates.
    await this.txManager.run(ctx, async (txCtx) => {
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
