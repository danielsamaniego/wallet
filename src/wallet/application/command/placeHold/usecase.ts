import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { Hold } from "../../../domain/hold/hold.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
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
      amount_minor: Number(cmd.amountMinor),
    });

    const holdId = this.idGen.newId();
    let walletCurrency = "";

    await this.txManager.run(ctx, async (txCtx) => {
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: cmd.walletId });
        throw ErrWalletNotFound(cmd.walletId);
      }
      walletCurrency = wallet.currencyCode;
      if (wallet.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} platform mismatch`, {
          wallet_id: cmd.walletId,
          currency_code: wallet.currencyCode,
          expected_platform_id: cmd.platformId,
          actual_platform_id: wallet.platformId,
        });
        throw ErrWalletNotFound(cmd.walletId);
      }

      if (wallet.status !== "active") {
        this.logger.warn(txCtx, `${methodLogTag} wallet not active`, {
          wallet_id: wallet.id,
          currency_code: wallet.currencyCode,
          status: wallet.status,
        });
        throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${wallet.id} is not active`);
      }

      const now = Date.now();

      // Calculate available balance
      const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
      const availableBalance = wallet.cachedBalanceMinor - activeHolds;

      this.logger.debug(txCtx, `${methodLogTag} balance check`, {
        wallet_id: wallet.id,
        currency_code: wallet.currencyCode,
        cached_balance_minor: Number(wallet.cachedBalanceMinor),
        active_holds_minor: Number(activeHolds),
        available_balance_minor: Number(availableBalance),
      });

      if (cmd.amountMinor > availableBalance) {
        this.logger.warn(txCtx, `${methodLogTag} insufficient funds`, {
          wallet_id: wallet.id,
          currency_code: wallet.currencyCode,
          requested_minor: Number(cmd.amountMinor),
          available_balance_minor: Number(availableBalance),
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
        amountMinor: cmd.amountMinor,
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
      currency_code: walletCurrency,
      amount_minor: Number(cmd.amountMinor),
    });

    return { holdId };
  }
}
