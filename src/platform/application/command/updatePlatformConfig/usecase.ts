import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../../wallet/domain/ports/wallet.repository.js";
import { ErrPlatformNotFound } from "../../../domain/platform/platform.errors.js";
import type { IPlatformRepository } from "../../../domain/ports/platform.repository.js";
import type { UpdatePlatformConfigCommand, UpdatePlatformConfigResult } from "./command.js";

const mainLogTag = "UpdatePlatformConfigUseCase";

export class UpdatePlatformConfigUseCase
  implements ICommandHandler<UpdatePlatformConfigCommand, UpdatePlatformConfigResult>
{
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly platformRepo: IPlatformRepository,
    private readonly walletRepo: IWalletRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(
    ctx: AppContext,
    cmd: UpdatePlatformConfigCommand,
  ): Promise<UpdatePlatformConfigResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: cmd.platformId,
      allow_negative_balance: cmd.allowNegativeBalance,
      system_wallet_shard_count: cmd.systemWalletShardCount,
    });

    await this.txManager.run(ctx, async (txCtx) => {
      const platform = await this.platformRepo.findById(txCtx, cmd.platformId);
      if (!platform) {
        this.logger.warn(txCtx, `${methodLogTag} platform not found`, {
          platform_id: cmd.platformId,
        });
        throw ErrPlatformNotFound(cmd.platformId);
      }

      const now = Date.now();

      if (cmd.allowNegativeBalance !== undefined) {
        platform.setAllowNegativeBalance(cmd.allowNegativeBalance, now);
      }

      if (cmd.systemWalletShardCount !== undefined) {
        // Domain enforces only-increase and bounds. If validation fails, the tx
        // rolls back before any shards are touched.
        platform.setSystemWalletShardCount(cmd.systemWalletShardCount, now);
      }

      await this.platformRepo.save(txCtx, platform);

      // If the shard count changed, eagerly materialise the new shards for
      // every currency the platform already uses. Idempotent via
      // ensureSystemWalletShards' ON CONFLICT DO NOTHING.
      if (cmd.systemWalletShardCount !== undefined) {
        const currencies = await this.walletRepo.listSystemWalletCurrencies(txCtx, cmd.platformId);
        for (const currency of currencies) {
          await this.walletRepo.ensureSystemWalletShards(
            txCtx,
            cmd.platformId,
            currency,
            cmd.systemWalletShardCount,
            now,
          );
        }
        this.logger.info(txCtx, `${methodLogTag} shards materialised`, {
          platform_id: cmd.platformId,
          shard_count: cmd.systemWalletShardCount,
          currencies_updated: currencies.length,
        });
      }
    });

    this.logger.info(ctx, `${methodLogTag} config updated`, {
      platform_id: cmd.platformId,
      allow_negative_balance: cmd.allowNegativeBalance,
      system_wallet_shard_count: cmd.systemWalletShardCount,
    });

    return { platformId: cmd.platformId };
  }
}
