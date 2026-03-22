import { AppError } from "../../../../shared/domain/appError.js";
import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { Hold } from "../../../domain/hold/hold.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ITransactionManager } from "../../../../shared/domain/kernel/transaction.manager.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { PlaceHoldCommand, PlaceHoldResult } from "./command.js";

const mainLogTag = "PlaceHoldUseCase";

export class PlaceHoldUseCase implements ICommandHandler<PlaceHoldCommand, PlaceHoldResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: PlaceHoldCommand): Promise<PlaceHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_cents: Number(cmd.amountCents),
    });

    const holdId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: cmd.walletId });
        throw ErrWalletNotFound(cmd.walletId);
      }
      if (wallet.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} platform mismatch`, {
          wallet_id: cmd.walletId,
          expected_platform_id: cmd.platformId,
          actual_platform_id: wallet.platformId,
        });
        throw ErrWalletNotFound(cmd.walletId);
      }

      if (wallet.status !== "active") {
        this.logger.warn(txCtx, `${methodLogTag} wallet not active`, {
          wallet_id: wallet.id,
          status: wallet.status,
        });
        throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${wallet.id} is not active`);
      }

      const now = Date.now();

      // Calculate available balance
      const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
      const availableBalance = wallet.cachedBalanceCents - activeHolds;

      this.logger.debug(txCtx, `${methodLogTag} balance check`, {
        wallet_id: wallet.id,
        cached_balance_cents: Number(wallet.cachedBalanceCents),
        active_holds_cents: Number(activeHolds),
        available_balance_cents: Number(availableBalance),
      });

      if (cmd.amountCents > availableBalance) {
        this.logger.warn(txCtx, `${methodLogTag} insufficient funds`, {
          wallet_id: wallet.id,
          requested_cents: Number(cmd.amountCents),
          available_balance_cents: Number(availableBalance),
        });
        throw AppError.domainRule(
          "INSUFFICIENT_FUNDS",
          `wallet ${wallet.id} has insufficient available funds for hold`,
        );
      }

      // Participate in optimistic locking so concurrent PlaceHold/VoidHold
      // on the same wallet contend for the version and only one wins.
      wallet.touchForHoldChange(now); // Just update the updatedAt timestamp.

      const hold = Hold.create({
        id: holdId,
        walletId: wallet.id,
        amountCents: cmd.amountCents,
        reference: cmd.reference ?? null,
        expiresAt: cmd.expiresAt ?? null,
        now,
      });

      await this.walletRepo.save(txCtx, wallet); // If version mismatch, the save will fail with VERSION_CONFLICT.
      await this.holdRepo.save(txCtx, hold);
    });

    this.logger.info(ctx, `${methodLogTag} hold placed`, {
      hold_id: holdId,
      wallet_id: cmd.walletId,
      amount_cents: Number(cmd.amountCents),
    });

    return { holdId };
  }
}
