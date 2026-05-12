import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { Movement } from "../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { IResultPublisher } from "../../../domain/ports/result.publisher.js";
import type { AdjustBalanceService } from "../../command/adjustBalance/service.js";
import type { CaptureHoldService } from "../../command/captureHold/service.js";
import type { ChargeService } from "../../command/charge/service.js";
import type { DepositService } from "../../command/deposit/service.js";
import type { TransferService } from "../../command/transfer/service.js";
import type { WithdrawService } from "../../command/withdraw/service.js";
import type { ProcessMovementCommand, ProcessMovementResult } from "./command.js";
import {
  hydrateAdjustment,
  hydrateCaptureHold,
  hydrateCharge,
  hydrateDeposit,
  hydrateTransfer,
  hydrateWithdraw,
} from "./payload.js";

const mainLogTag = "ProcessMovementUseCase";

/**
 * Async-path orchestrator. Invoked by the QStash worker route once a
 * signed delivery arrives. Responsible end-to-end for:
 *
 *   1. Atomic claim — `pending → processing` via `markProcessing`. If
 *      another worker already won the race the row is no longer
 *      `pending`, so we return `noop` and the queue acks.
 *   2. Hydrating the operation command from `movement.queue_payload`
 *      (BigInt-encoded amounts come back as strings; the per-type
 *      hydrator validates and converts).
 *   3. Wrapping the matching `<op>Service.execute` in the same lock +
 *      tx envelope the sync use cases use. The `markPosted` transition
 *      lives **inside** the tx so ledger writes and the movement
 *      lifecycle commit atomically — a partial commit would leave a
 *      "processing" row with posted ledger entries for the reconciliation
 *      job to untangle.
 *   4. On any thrown error: best-effort `markFailed` + `publish(failed)`.
 *      Both are wrapped in their own try/catch so a Redis blip after a
 *      DB blip does not mask the original cause. The queue always gets
 *      a 200 once the claim succeeded — re-delivery on the same id
 *      would just observe a non-pending row and short-circuit.
 *   5. On success: `publish(posted)` so the awaiting handler can return
 *      200 with the full response body (the sync illusion).
 *
 * The use case does NOT retry on transient errors. A Prisma write
 * conflict, a Redis disconnect during the lock acquire, or any other
 * transient failure marks the movement `failed`. A later phase will
 * introduce bounded retries; for now, "transient = failed" keeps the
 * semantics simple — the client can resubmit with a new idempotency
 * key after observing 5xx → poll → status=failed.
 */
export class ProcessMovementUseCase
  implements ICommandHandler<ProcessMovementCommand, ProcessMovementResult>
{
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly lockRunner: LockRunner,
    private readonly movementRepo: IMovementRepository,
    private readonly resultPublisher: IResultPublisher,
    private readonly depositService: DepositService,
    private readonly withdrawService: WithdrawService,
    private readonly transferService: TransferService,
    private readonly chargeService: ChargeService,
    private readonly adjustBalanceService: AdjustBalanceService,
    private readonly captureHoldService: CaptureHoldService,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: ProcessMovementCommand): Promise<ProcessMovementResult> {
    const methodLogTag = `${mainLogTag} | handle`;
    const { movementId } = cmd;

    this.logger.debug(ctx, `${methodLogTag} start`, { movement_id: movementId });

    const claimed = await this.movementRepo.markProcessing(ctx, movementId);
    if (claimed === null) {
      // Either another worker beat us to the claim, or the row is already
      // terminal. Both are benign — ack the queue without publishing.
      this.logger.info(ctx, `${methodLogTag} noop — already claimed or non-pending`, {
        movement_id: movementId,
      });
      return { outcome: "noop" };
    }

    try {
      await this.dispatchByType(ctx, claimed);
      await this.resultPublisher.publish(ctx, { movementId, status: "posted" });
      this.logger.info(ctx, `${methodLogTag} posted`, {
        movement_id: movementId,
        movement_type: claimed.type,
      });
      return { outcome: "posted" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(ctx, `${methodLogTag} processing failed`, {
        movement_id: movementId,
        movement_type: claimed.type,
        error: reason,
      });

      // Best-effort markFailed. If this also throws, log but keep going —
      // we still want to attempt the result publish so any awaiting
      // handler can stop polling.
      try {
        await this.movementRepo.markFailed(ctx, movementId, reason);
      } catch (markErr) {
        this.logger.error(ctx, `${methodLogTag} markFailed also threw`, {
          movement_id: movementId,
          error: markErr instanceof Error ? markErr.message : String(markErr),
        });
      }

      try {
        await this.resultPublisher.publish(ctx, {
          movementId,
          status: "failed",
          failedReason: reason,
        });
      } catch (pubErr) {
        this.logger.error(ctx, `${methodLogTag} publish(failed) also threw`, {
          movement_id: movementId,
          error: pubErr instanceof Error ? pubErr.message : String(pubErr),
        });
      }

      return { outcome: "failed", failedReason: reason };
    }
  }

  /**
   * Hydrates the per-type command from `movement.queue_payload`, derives
   * the lock keys, then runs `service.execute` + `markPosted` inside the
   * same lock + tx envelope. Throws on hydration errors or service
   * errors — the outer `handle` translates that to `failed`.
   */
  private async dispatchByType(ctx: AppContext, movement: Movement): Promise<void> {
    switch (movement.type) {
      case "deposit": {
        const { command, lockKeys } = hydrateDeposit(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.depositService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
      case "withdrawal": {
        const { command, lockKeys } = hydrateWithdraw(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.withdrawService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
      case "charge": {
        const { command, lockKeys } = hydrateCharge(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.chargeService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
      case "adjustment": {
        const { command, lockKeys } = hydrateAdjustment(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.adjustBalanceService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
      case "transfer": {
        const { command, lockKeys } = hydrateTransfer(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.transferService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
      case "hold_capture": {
        const { command, lockKeys } = hydrateCaptureHold(movement);
        await this.lockRunner.run(ctx, lockKeys, async () => {
          await this.txManager.run(ctx, async (txCtx) => {
            await this.captureHoldService.execute(txCtx, command, movement);
            await this.movementRepo.markPosted(txCtx, movement.id);
          });
        });
        return;
      }
    }
  }
}
