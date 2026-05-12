// TODO(historical-import-temp): Remove this entire use case after all legacy
// consumers have completed their historical import. See command.ts for
// rationale. This file deliberately mirrors AdjustBalanceUseCase so that when
// it is removed, only the extra timestamp wiring disappears.
import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ImportHistoricalEntryCommand, ImportHistoricalEntryResult } from "./command.js";
import type { ImportHistoricalEntryService } from "./service.js";

const mainLogTag = "ImportHistoricalEntryUseCase";

/**
 * Synchronous-path orchestrator for historical (back-dated) entry imports.
 * Owns lock + tx + Movement lifecycle (the Movement carries the historical
 * timestamp); delegates business rules to `ImportHistoricalEntryService`.
 * Reused verbatim by the Phase 2 async worker.
 */
export class ImportHistoricalEntryUseCase
  implements ICommandHandler<ImportHistoricalEntryCommand, ImportHistoricalEntryResult>
{
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly importHistoricalEntryService: ImportHistoricalEntryService,
  ) {}

  async handle(
    ctx: AppContext,
    cmd: ImportHistoricalEntryCommand,
  ): Promise<ImportHistoricalEntryResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
      historical_created_at: cmd.historicalCreatedAt,
    });

    let result!: ImportHistoricalEntryResult;

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "adjustment",
          platformId: cmd.platformId,
          reason: cmd.reason,
          createdAt: cmd.historicalCreatedAt,
        });
        await this.movementRepo.save(txCtx, movement);
        result = await this.importHistoricalEntryService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
