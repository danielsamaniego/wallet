import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { AdjustBalanceCommand, AdjustBalanceResult } from "./command.js";
import type { AdjustBalanceService } from "./service.js";

const mainLogTag = "AdjustBalanceUseCase";

/**
 * Synchronous-path orchestrator for an administrative balance adjustment.
 * Owns lock + tx + Movement lifecycle; delegates business rules (including
 * sign handling and the `allow_negative_balance` flag) to
 * `AdjustBalanceService`. Reused verbatim by the Phase 2 async worker.
 */
export class AdjustBalanceUseCase
  implements ICommandHandler<AdjustBalanceCommand, AdjustBalanceResult>
{
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly adjustBalanceService: AdjustBalanceService,
  ) {}

  async handle(ctx: AppContext, cmd: AdjustBalanceCommand): Promise<AdjustBalanceResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    let result!: AdjustBalanceResult;

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "adjustment",
          platformId: cmd.platformId,
          reason: cmd.reason,
          createdAt: Date.now(),
        });
        await this.movementRepo.save(txCtx, movement);
        result = await this.adjustBalanceService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
