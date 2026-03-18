import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import {
  ErrCurrencyMismatch,
  ErrSameWallet,
  ErrWalletNotFound,
} from "../../../domain/wallet/wallet.errors.js";
import type { TransferCommand, TransferResult } from "./command.js";

const mainLogTag = "TransferHandler";

export class TransferHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: TransferCommand): Promise<TransferResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      source_wallet_id: cmd.sourceWalletId,
      target_wallet_id: cmd.targetWalletId,
      amount_cents: Number(cmd.amountCents),
    });

    if (cmd.sourceWalletId === cmd.targetWalletId) {
      throw ErrSameWallet();
    }

    const sourceTxId = this.idGen.newId();
    const targetTxId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      const source = await this.walletRepo.findById(txCtx, cmd.sourceWalletId);
      if (!source) throw ErrWalletNotFound(cmd.sourceWalletId);
      if (source.platformId !== cmd.platformId) throw ErrWalletNotFound(cmd.sourceWalletId);

      const target = await this.walletRepo.findById(txCtx, cmd.targetWalletId);
      if (!target) throw ErrWalletNotFound(cmd.targetWalletId);
      if (target.platformId !== cmd.platformId) throw ErrWalletNotFound(cmd.targetWalletId);

      if (source.currencyCode !== target.currencyCode) {
        throw ErrCurrencyMismatch();
      }

      const now = Date.now();

      // Available balance for source
      const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, source.id);
      const availableBalance = source.cachedBalanceCents - activeHolds;

      this.logger.debug(txCtx, `${methodLogTag} source balance check`, {
        source_wallet_id: source.id,
        cached_balance_cents: Number(source.cachedBalanceCents),
        active_holds_cents: Number(activeHolds),
        available_balance_cents: Number(availableBalance),
      });

      // Mutate
      source.withdraw(cmd.amountCents, availableBalance, now);
      target.deposit(cmd.amountCents, now);

      // Transactions
      const outTx = Transaction.create({
        id: sourceTxId,
        walletId: source.id,
        counterpartWalletId: target.id,
        type: "transfer_out",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      const inTx = Transaction.create({
        id: targetTxId,
        walletId: target.id,
        counterpartWalletId: source.id,
        type: "transfer_in",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: null,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      // Ledger entries: 1 DEBIT on source (transfer_out), 1 CREDIT on target (transfer_in)
      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: sourceTxId,
        walletId: source.id,
        entryType: "DEBIT",
        amountCents: -cmd.amountCents,
        balanceAfterCents: source.cachedBalanceCents,
        createdAt: now,
      });

      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: targetTxId,
        walletId: target.id,
        entryType: "CREDIT",
        amountCents: cmd.amountCents,
        balanceAfterCents: target.cachedBalanceCents,
        createdAt: now,
      });

      await this.walletRepo.save(txCtx, source);
      await this.walletRepo.save(txCtx, target);
      await this.transactionRepo.saveMany(txCtx, [outTx, inTx]);
      await this.ledgerEntryRepo.saveMany(txCtx, [debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} transfer success`, {
      source_wallet_id: cmd.sourceWalletId,
      target_wallet_id: cmd.targetWalletId,
      source_transaction_id: sourceTxId,
      target_transaction_id: targetTxId,
      amount_cents: Number(cmd.amountCents),
    });

    return { sourceTransactionId: sourceTxId, targetTransactionId: targetTxId };
  }
}
