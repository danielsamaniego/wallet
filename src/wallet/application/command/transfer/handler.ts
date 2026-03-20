import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
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
    private readonly movementRepo: IMovementRepository,
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
      this.logger.warn(ctx, `${methodLogTag} same wallet transfer rejected`, {
        wallet_id: cmd.sourceWalletId,
      });
      throw ErrSameWallet();
    }

    const sourceTxId = this.idGen.newId();
    const targetTxId = this.idGen.newId();
    const movementId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      const source = await this.walletRepo.findById(txCtx, cmd.sourceWalletId);
      if (!source) {
        this.logger.warn(txCtx, `${methodLogTag} source wallet not found`, {
          source_wallet_id: cmd.sourceWalletId,
        });
        throw ErrWalletNotFound(cmd.sourceWalletId);
      }
      if (source.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} source platform mismatch`, {
          source_wallet_id: cmd.sourceWalletId,
          expected_platform_id: cmd.platformId,
          actual_platform_id: source.platformId,
        });
        throw ErrWalletNotFound(cmd.sourceWalletId);
      }

      const target = await this.walletRepo.findById(txCtx, cmd.targetWalletId);
      if (!target) {
        this.logger.warn(txCtx, `${methodLogTag} target wallet not found`, {
          target_wallet_id: cmd.targetWalletId,
        });
        throw ErrWalletNotFound(cmd.targetWalletId);
      }
      if (target.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} target platform mismatch`, {
          target_wallet_id: cmd.targetWalletId,
          expected_platform_id: cmd.platformId,
          actual_platform_id: target.platformId,
        });
        throw ErrWalletNotFound(cmd.targetWalletId);
      }

      if (source.currencyCode !== target.currencyCode) {
        this.logger.warn(txCtx, `${methodLogTag} currency mismatch`, {
          source_wallet_id: source.id,
          source_currency: source.currencyCode,
          target_wallet_id: target.id,
          target_currency: target.currencyCode,
        });
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

      // Create movement (journal entry — groups both sides of the transfer)
      const movement = Movement.create({ id: movementId, type: "transfer", createdAt: now });

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
        movementId,
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
        movementId,
        createdAt: now,
      });

      // Ledger entries: 1 DEBIT on source, 1 CREDIT on target — same movementId
      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: sourceTxId,
        walletId: source.id,
        entryType: "DEBIT",
        amountCents: -cmd.amountCents,
        balanceAfterCents: source.cachedBalanceCents,
        movementId,
        createdAt: now,
      });

      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: targetTxId,
        walletId: target.id,
        entryType: "CREDIT",
        amountCents: cmd.amountCents,
        balanceAfterCents: target.cachedBalanceCents,
        movementId,
        createdAt: now,
      });

      // Persist (movement first — FK constraint).
      // Wallets saved in deterministic ID order to prevent deadlocks:
      // concurrent transfers A→B and B→A both lock the lower-ID wallet
      // first, so the lock cycle that causes deadlock cannot form.
      await this.movementRepo.save(txCtx, movement);
      const [first, second] =
        source.id < target.id // Avoid deadlocks deterministically
          ? [source, target]
          : [target, source];
      await this.walletRepo.save(txCtx, first);
      await this.walletRepo.save(txCtx, second);
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

    return { sourceTransactionId: sourceTxId, targetTransactionId: targetTxId, movementId };
  }
}
