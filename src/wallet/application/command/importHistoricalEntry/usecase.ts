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
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { ImportHistoricalEntryCommand, ImportHistoricalEntryResult } from "./command.js";

const mainLogTag = "ImportHistoricalEntryUseCase";

export class ImportHistoricalEntryUseCase
  implements ICommandHandler<ImportHistoricalEntryCommand, ImportHistoricalEntryResult>
{
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
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

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
        if (!wallet) {
          this.logger.warn(txCtx, `${methodLogTag} wallet not found`, {
            wallet_id: cmd.walletId,
          });
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

        // Historical timestamp is the source of truth for all journal entities
        // (Movement, Transaction, LedgerEntry) so the imported history reflects
        // the original event times end-to-end. Wallet aggregates are also
        // touched at this timestamp: since imports run in chronological order,
        // the wallet's updatedAt advances monotonically just as it would under
        // normal live operations.
        const historicalAt = cmd.historicalCreatedAt;

        // Compute real available balance (cached minus present-day active holds).
        // Even though the historical event pre-dates today's holds, allowing the import to
        // reduce the balance below the sum of active holds would make those holds permanently
        // uncapturable (zombie holds: capture calls wallet.withdraw which requires cached >= hold).
        // The operator must void active holds before importing entries that would break them.
        let availableBalance = wallet.cachedBalanceMinor;
        if (cmd.amountMinor < 0n) {
          const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
          availableBalance = wallet.cachedBalanceMinor - activeHolds;

          this.logger.debug(txCtx, `${methodLogTag} balance check`, {
            wallet_id: wallet.id,
            currency_code: wallet.currencyCode,
            cached_balance_minor: Number(wallet.cachedBalanceMinor),
            active_holds_minor: Number(activeHolds),
            available_balance_minor: Number(availableBalance),
          });
        }

        const movement = Movement.create({
          id: movementId,
          type: "adjustment",
          reason: cmd.reason,
          createdAt: historicalAt,
        });

        // Historical import is privileged: negative balances always allowed (migration path).
        wallet.adjust(cmd.amountMinor, availableBalance, true, historicalAt);

        const isCredit = cmd.amountMinor > 0n;
        const absAmount = isCredit ? cmd.amountMinor : -cmd.amountMinor;
        const txType = isCredit ? "adjustment_credit" : "adjustment_debit";
        const systemDelta = isCredit ? -absAmount : absAmount;

        const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
        const systemSide = await this.walletRepo.adjustSystemShardBalance(
          txCtx,
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
          movementId,
          createdAt: historicalAt,
        });

        const userEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: wallet.id,
          entryType: isCredit ? "CREDIT" : "DEBIT",
          amountMinor: isCredit ? absAmount : -absAmount,
          balanceAfterMinor: wallet.cachedBalanceMinor,
          movementId,
          createdAt: historicalAt,
        });

        const systemEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: systemSide.walletId,
          entryType: isCredit ? "DEBIT" : "CREDIT",
          amountMinor: isCredit ? -absAmount : absAmount,
          balanceAfterMinor: systemSide.cachedBalanceMinor,
          movementId,
          createdAt: historicalAt,
        });

        // movement first: ledger_entries.movement_id FK requires it
        await this.movementRepo.save(txCtx, movement);
        await this.walletRepo.save(txCtx, wallet);
        await this.transactionRepo.save(txCtx, tx);
        await this.ledgerEntryRepo.saveMany(txCtx, [userEntry, systemEntry]);
      });
    });

    this.logger.info(ctx, `${methodLogTag} import success`, {
      wallet_id: cmd.walletId,
      currency_code: walletCurrency,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
      historical_created_at: cmd.historicalCreatedAt,
    });

    return { transactionId: txId, movementId };
  }
}
