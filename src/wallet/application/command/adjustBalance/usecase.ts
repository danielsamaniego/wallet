import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import {
  ErrSystemWalletNotFound,
  ErrWalletNotFound,
} from "../../../domain/wallet/wallet.errors.js";
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
  ) {}

  async handle(ctx: AppContext, cmd: AdjustBalanceCommand): Promise<AdjustBalanceResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_cents: Number(cmd.amountCents),
    });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();

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

      const systemWallet = await this.walletRepo.findSystemWallet(
        txCtx,
        wallet.platformId,
        wallet.currencyCode,
      );
      if (!systemWallet) {
        this.logger.warn(txCtx, `${methodLogTag} system wallet not found`, {
          platform_id: wallet.platformId,
          currency_code: wallet.currencyCode,
        });
        throw ErrSystemWalletNotFound(wallet.platformId, wallet.currencyCode);
      }

      const now = Date.now();

      // For negative adjustments, compute available balance (cached - active holds)
      let availableBalance = wallet.cachedBalanceCents;
      if (cmd.amountCents < 0n) {
        const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
        availableBalance = wallet.cachedBalanceCents - activeHolds;

        this.logger.debug(txCtx, `${methodLogTag} balance check`, {
          wallet_id: wallet.id,
          cached_balance_cents: Number(wallet.cachedBalanceCents),
          active_holds_cents: Number(activeHolds),
          available_balance_cents: Number(availableBalance),
        });
      }

      // Create movement (journal entry)
      const movement = Movement.create({
        id: movementId,
        type: "adjustment",
        reason: cmd.reason,
        createdAt: now,
      });

      // Mutate user wallet aggregate
      wallet.adjust(cmd.amountCents, availableBalance, now);

      // Determine direction for transaction type and ledger entries
      const isCredit = cmd.amountCents > 0n;
      const absAmount = isCredit ? cmd.amountCents : -cmd.amountCents;
      const txType = isCredit ? "adjustment_credit" : "adjustment_debit";

      // System wallet: compute snapshot for ledger entry (approximate under concurrency)
      const systemDelta = isCredit ? -absAmount : absAmount;
      const systemBalanceAfter = systemWallet.cachedBalanceCents + systemDelta;

      // Create transaction
      const tx = Transaction.create({
        id: txId,
        walletId: wallet.id,
        counterpartWalletId: systemWallet.id,
        type: txType,
        amountCents: absAmount,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: cmd.reference ?? null,
        metadata: cmd.metadata ?? null,
        holdId: null,
        movementId,
        createdAt: now,
      });

      // Create ledger entries
      const userEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: wallet.id,
        entryType: isCredit ? "CREDIT" : "DEBIT",
        amountCents: isCredit ? absAmount : -absAmount,
        balanceAfterCents: wallet.cachedBalanceCents,
        movementId,
        createdAt: now,
      });

      const systemEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: systemWallet.id,
        entryType: isCredit ? "DEBIT" : "CREDIT",
        amountCents: isCredit ? -absAmount : absAmount,
        balanceAfterCents: systemBalanceAfter,
        movementId,
        createdAt: now,
      });

      // Persist (movement first — FK constraint)
      await this.movementRepo.save(txCtx, movement);
      await this.walletRepo.save(txCtx, wallet);
      await this.walletRepo.adjustSystemWalletBalance(txCtx, systemWallet.id, systemDelta, now);
      await this.transactionRepo.save(txCtx, tx);
      await this.ledgerEntryRepo.saveMany(txCtx, [userEntry, systemEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} adjustment success`, {
      wallet_id: cmd.walletId,
      transaction_id: txId,
      amount_cents: Number(cmd.amountCents),
    });

    return { transactionId: txId, movementId };
  }
}
