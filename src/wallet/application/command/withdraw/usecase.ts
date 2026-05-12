import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { WithdrawCommand, WithdrawResult } from "./command.js";
import type { WithdrawService } from "./service.js";

const mainLogTag = "WithdrawUseCase";

/**
 * Synchronous-path orchestrator for a withdrawal. Owns lock + tx + Movement
 * lifecycle; delegates business rules to `WithdrawService`. Reused verbatim
 * by the Phase 2 async worker which constructs a `Movement` from a
 * pre-existing `pending` row.
 */
export class WithdrawUseCase implements ICommandHandler<WithdrawCommand, WithdrawResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly withdrawService: WithdrawService,
  ) {}

  async handle(ctx: AppContext, cmd: WithdrawCommand): Promise<WithdrawResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    let result!: WithdrawResult;

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "withdrawal",
          platformId: cmd.platformId,
          createdAt: Date.now(),
        });
        // movement first: ledger_entries.movement_id FK requires it.
        await this.movementRepo.save(txCtx, movement);
        result = await this.withdrawService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
