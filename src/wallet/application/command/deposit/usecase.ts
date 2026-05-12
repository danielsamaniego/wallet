import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { DepositCommand, DepositResult } from "./command.js";
import type { DepositService } from "./service.js";

const mainLogTag = "DepositUseCase";

/**
 * Synchronous-path orchestrator for a deposit. Owns:
 *
 *   - the per-wallet distributed lock (so concurrent deposits to the same
 *     wallet are serialized);
 *   - the database transaction (so all writes commit atomically);
 *   - the Movement lifecycle (creates a fresh `posted` Movement before the
 *     business logic runs).
 *
 * The business rules themselves live in `DepositService` and are reused
 * verbatim by the async worker (Phase 2), which constructs a Movement from a
 * pre-existing `pending` row instead of creating a new one.
 */
export class DepositUseCase implements ICommandHandler<DepositCommand, DepositResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly depositService: DepositService,
  ) {}

  async handle(ctx: AppContext, cmd: DepositCommand): Promise<DepositResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    let result!: DepositResult;

    // Serialize concurrent deposits to the same wallet. The lock runner falls
    // through silently if the feature is disabled or the backend is down —
    // the TransactionManager's optimistic-locking retries remain as a safety
    // net.
    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "deposit",
          createdAt: Date.now(),
        });
        // movement first: ledger_entries.movement_id FK requires it.
        await this.movementRepo.save(txCtx, movement);
        result = await this.depositService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
