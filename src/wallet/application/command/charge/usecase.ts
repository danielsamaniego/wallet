import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ChargeCommand, ChargeResult } from "./command.js";
import type { ChargeService } from "./service.js";

const mainLogTag = "ChargeUseCase";

/**
 * Synchronous-path orchestrator for a charge. Owns lock + tx + Movement
 * lifecycle; delegates business rules to `ChargeService`. Reused verbatim
 * by the Phase 2 async worker.
 */
export class ChargeUseCase implements ICommandHandler<ChargeCommand, ChargeResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly chargeService: ChargeService,
  ) {}

  async handle(ctx: AppContext, cmd: ChargeCommand): Promise<ChargeResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    let result!: ChargeResult;

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "charge",
          createdAt: Date.now(),
        });
        await this.movementRepo.save(txCtx, movement);
        result = await this.chargeService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
