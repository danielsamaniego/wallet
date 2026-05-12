import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { AdjustBalanceCommand, AdjustBalanceResult } from "./command.js";

const mainLogTag = "AdjustBalanceService";

/**
 * Business core of an administrative adjustment. Handles signed amount
 * (positive = credit, negative = debit), the `allow_negative_balance`
 * platform flag, and the credit/debit transaction-type split. Shared by
 * `AdjustBalanceUseCase` (sync path) and the Phase 2 async worker.
 */
export class AdjustBalanceService {
  constructor(
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async execute(
    ctx: AppContext,
    cmd: AdjustBalanceCommand,
    movement: Movement,
  ): Promise<AdjustBalanceResult> {
    const methodLogTag = `${mainLogTag} | execute`;

    const wallet = await this.walletRepo.findById(ctx, cmd.walletId);
    if (!wallet) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: cmd.walletId });
      throw ErrWalletNotFound(cmd.walletId);
    }
    if (wallet.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} platform mismatch`, {
        wallet_id: cmd.walletId,
        currency_code: wallet.currencyCode,
        expected_platform_id: cmd.platformId,
        actual_platform_id: wallet.platformId,
      });
      throw ErrWalletNotFound(cmd.walletId);
    }

    const now = Date.now();
    const txId = this.idGen.newId();

    let availableBalance = wallet.cachedBalanceMinor;
    if (cmd.amountMinor < 0n) {
      const activeHolds = await this.holdRepo.sumActiveHolds(ctx, wallet.id);
      availableBalance = wallet.cachedBalanceMinor - activeHolds;

      this.logger.debug(ctx, `${methodLogTag} balance check`, {
        wallet_id: wallet.id,
        currency_code: wallet.currencyCode,
        cached_balance_minor: Number(wallet.cachedBalanceMinor),
        active_holds_minor: Number(activeHolds),
        available_balance_minor: Number(availableBalance),
      });
    }

    wallet.adjust(cmd.amountMinor, availableBalance, cmd.allowNegativeBalance, now);

    const isCredit = cmd.amountMinor > 0n;
    const absAmount = isCredit ? cmd.amountMinor : -cmd.amountMinor;
    const txType = isCredit ? "adjustment_credit" : "adjustment_debit";
    const systemDelta = isCredit ? -absAmount : absAmount;

    const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
    const systemSide = await this.walletRepo.adjustSystemShardBalance(
      ctx,
      wallet.platformId,
      wallet.currencyCode,
      shardIndex,
      systemDelta,
      now,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: txType,
      amountMinor: absAmount,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: now,
    });

    const userEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: wallet.id,
      entryType: isCredit ? "CREDIT" : "DEBIT",
      amountMinor: isCredit ? absAmount : -absAmount,
      balanceAfterMinor: wallet.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    const systemEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: systemSide.walletId,
      entryType: isCredit ? "DEBIT" : "CREDIT",
      amountMinor: isCredit ? -absAmount : absAmount,
      balanceAfterMinor: systemSide.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    await this.walletRepo.save(ctx, wallet);
    await this.transactionRepo.save(ctx, tx);
    await this.ledgerEntryRepo.saveMany(ctx, [userEntry, systemEntry]);

    this.logger.info(ctx, `${methodLogTag} adjustment success`, {
      wallet_id: cmd.walletId,
      currency_code: wallet.currencyCode,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId: movement.id };
  }
}
