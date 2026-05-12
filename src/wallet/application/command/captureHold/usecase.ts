import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import type { CaptureHoldCommand, CaptureHoldResult } from "./command.js";
import type { CaptureHoldService } from "./service.js";

const mainLogTag = "CaptureHoldUseCase";

/**
 * Synchronous-path orchestrator for capturing a hold. Owns:
 *
 *   - the pre-lock cross-tenant guard: resolves the hold → wallet → platform
 *     BEFORE acquiring the lock, so an attacker cannot DoS another tenant
 *     by hammering a known holdId. Cross-tenant requests collapse to 404
 *     before any expensive work happens;
 *   - per-wallet lock + tx envelope;
 *   - Movement creation/save.
 *
 * Business rules live in `CaptureHoldService`, reused verbatim by the
 * Phase 2 async worker.
 */
export class CaptureHoldUseCase implements ICommandHandler<CaptureHoldCommand, CaptureHoldResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
    private readonly captureHoldService: CaptureHoldService,
  ) {}

  async handle(ctx: AppContext, cmd: CaptureHoldCommand): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    // Pre-lock cross-tenant guard — see class doc.
    const holdForKey = await this.holdRepo.findById(ctx, cmd.holdId);
    if (!holdForKey) {
      this.logger.warn(ctx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
      throw ErrHoldNotFound(cmd.holdId);
    }

    const walletForKey = await this.walletRepo.findById(ctx, holdForKey.walletId);
    if (!walletForKey || walletForKey.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} cross-tenant pre-lock rejection`, {
        hold_id: cmd.holdId,
        wallet_id: holdForKey.walletId,
        expected_platform_id: cmd.platformId,
        actual_platform_id: walletForKey?.platformId,
      });
      throw ErrHoldNotFound(cmd.holdId);
    }

    let result!: CaptureHoldResult;

    await this.lockRunner.run(ctx, [`wallet-lock:${holdForKey.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const movement = Movement.create({
          id: this.idGen.newId(),
          type: "hold_capture",
          platformId: cmd.platformId,
          createdAt: Date.now(),
        });
        await this.movementRepo.save(txCtx, movement);
        result = await this.captureHoldService.execute(txCtx, cmd, movement);
      });
    });

    return result;
  }
}
