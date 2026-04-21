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
import type { AdjustBalanceCommand, AdjustBalanceResult } from "./command.js";

const mainLogTag = "AdjustBalanceUseCase";

export class AdjustBalanceUseCase
  implements ICommandHandler<AdjustBalanceCommand, AdjustBalanceResult>
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

  async handle(ctx: AppContext, cmd: AdjustBalanceCommand): Promise<AdjustBalanceResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
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

        const now = Date.now();

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
          createdAt: now,
        });

        wallet.adjust(cmd.amountMinor, availableBalance, cmd.allowNegativeBalance, now);

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
          movementId,
          createdAt: now,
        });

        const userEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: wallet.id,
          entryType: isCredit ? "CREDIT" : "DEBIT",
          amountMinor: isCredit ? absAmount : -absAmount,
          balanceAfterMinor: wallet.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        const systemEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: systemSide.walletId,
          entryType: isCredit ? "DEBIT" : "CREDIT",
          amountMinor: isCredit ? -absAmount : absAmount,
          balanceAfterMinor: systemSide.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        // movement first: ledger_entries.movement_id FK requires it
        await this.movementRepo.save(txCtx, movement);
        await this.walletRepo.save(txCtx, wallet);
        await this.transactionRepo.save(txCtx, tx);
        await this.ledgerEntryRepo.saveMany(txCtx, [userEntry, systemEntry]);
      });
    });

    this.logger.info(ctx, `${methodLogTag} adjustment success`, {
      wallet_id: cmd.walletId,
      currency_code: walletCurrency,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId };
  }
}
