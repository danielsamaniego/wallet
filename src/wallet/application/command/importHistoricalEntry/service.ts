// TODO(historical-import-temp): Remove this entire service after all legacy
// consumers have completed their historical import. Mirrors AdjustBalanceService
// with the extra `historical_created_at` wiring.
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
import type { ImportHistoricalEntryCommand, ImportHistoricalEntryResult } from "./command.js";

const mainLogTag = "ImportHistoricalEntryService";

/**
 * Business core of a historical (back-dated) entry import. All journal
 * entities are stamped with `cmd.historicalCreatedAt` so the imported
 * history reflects the original event times end-to-end. Negative balances
 * are always allowed for this privileged path. Shared by
 * `ImportHistoricalEntryUseCase` (sync path) and the Phase 2 async worker.
 */
export class ImportHistoricalEntryService {
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
    cmd: ImportHistoricalEntryCommand,
    movement: Movement,
  ): Promise<ImportHistoricalEntryResult> {
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

    const historicalAt = cmd.historicalCreatedAt;
    const txId = this.idGen.newId();

    // Compute real available balance (cached minus present-day active holds).
    // Even though the historical event pre-dates today's holds, allowing the
    // import to reduce the balance below the sum of active holds would make
    // those holds permanently uncapturable (zombie holds). The operator must
    // void active holds before importing entries that would break them.
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

    // Historical import is privileged: negative balances always allowed (migration path).
    wallet.adjust(cmd.amountMinor, availableBalance, true, historicalAt);

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
      historicalAt,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: txType,
      amountMinor: absAmount,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: cmd.reference,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: historicalAt,
    });

    const userEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: wallet.id,
      entryType: isCredit ? "CREDIT" : "DEBIT",
      amountMinor: isCredit ? absAmount : -absAmount,
      balanceAfterMinor: wallet.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: historicalAt,
    });

    const systemEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: systemSide.walletId,
      entryType: isCredit ? "DEBIT" : "CREDIT",
      amountMinor: isCredit ? -absAmount : absAmount,
      balanceAfterMinor: systemSide.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: historicalAt,
    });

    await this.walletRepo.save(ctx, wallet);
    await this.transactionRepo.save(ctx, tx);
    await this.ledgerEntryRepo.saveMany(ctx, [userEntry, systemEntry]);

    this.logger.info(ctx, `${methodLogTag} import success`, {
      wallet_id: cmd.walletId,
      currency_code: wallet.currencyCode,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
      historical_created_at: historicalAt,
    });

    return { transactionId: txId, movementId: movement.id };
  }
}
