import { AppError } from "../../../../shared/domain/appError.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { Hold } from "../../../domain/hold/hold.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { PlaceHoldCommand, PlaceHoldResult } from "./command.js";

const mainLogTag = "PlaceHoldHandler";

export class PlaceHoldHandler {
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
        throw ErrWalletNotFound(cmd.walletId);
      }
      if (wallet.platformId !== cmd.platformId) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      if (wallet.status !== "active") {
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
