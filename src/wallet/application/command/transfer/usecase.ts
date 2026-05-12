import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import { ErrSameWallet } from "../../../domain/wallet/wallet.errors.js";
import type { TransferCommand, TransferResult } from "./command.js";
import type { TransferService } from "./service.js";

const mainLogTag = "TransferUseCase";

/**
 * Synchronous-path orchestrator for a P2P transfer. Owns:
 *   - the same-wallet pre-check (a request-validation concern that does not
 *     need a tx);
 *   - per-wallet locks on BOTH wallets (LockRunner sorts + dedupes the keys
 *     so concurrent A→B and B→A cannot deadlock);
 *   - the transaction envelope;
 *   - Movement creation/save.
 *
 * Business rules live in `TransferService`, reused verbatim by the Phase 2
 * async worker.
 */
export class TransferUseCase implements ICommandHandler<TransferCommand, TransferResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly transferService: TransferService,
  ) {}

  async handle(ctx: AppContext, cmd: TransferCommand): Promise<TransferResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      source_wallet_id: cmd.sourceWalletId,
      target_wallet_id: cmd.targetWalletId,
      amount_minor: Number(cmd.amountMinor),
    });

    if (cmd.sourceWalletId === cmd.targetWalletId) {
      this.logger.warn(ctx, `${methodLogTag} same wallet transfer rejected`, {
        wallet_id: cmd.sourceWalletId,
      });
      throw ErrSameWallet();
    }

    let result!: TransferResult;

    await this.lockRunner.run(
      ctx,
      [`wallet-lock:${cmd.sourceWalletId}`, `wallet-lock:${cmd.targetWalletId}`],
      async () => {
        await this.txManager.run(ctx, async (txCtx) => {
          const movement = Movement.create({
            id: this.idGen.newId(),
            type: "transfer",
            createdAt: Date.now(),
          });
          await this.movementRepo.save(txCtx, movement);
          result = await this.transferService.execute(txCtx, cmd, movement);
        });
      },
    );

    return result;
  }
}
