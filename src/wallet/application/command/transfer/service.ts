import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrCurrencyMismatch, ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { TransferCommand, TransferResult } from "./command.js";

const mainLogTag = "TransferService";

/**
 * Business core of a P2P transfer. Handles validation of both wallets,
 * currency match, source available balance, and produces a single Movement
 * with two transactions and two ledger entries. Shared by `TransferUseCase`
 * (sync path) and the Phase 2 async worker.
 *
 * The caller MUST have acquired locks on BOTH wallets and opened a
 * transaction before invoking `execute`. The same-wallet pre-check is owned
 * by the caller (it's a request-validation concern, not a domain rule).
 */
export class TransferService {
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
    cmd: TransferCommand,
    movement: Movement,
  ): Promise<TransferResult> {
    const methodLogTag = `${mainLogTag} | execute`;

    const source = await this.walletRepo.findById(ctx, cmd.sourceWalletId);
    if (!source) {
      this.logger.warn(ctx, `${methodLogTag} source wallet not found`, {
        source_wallet_id: cmd.sourceWalletId,
      });
      throw ErrWalletNotFound(cmd.sourceWalletId);
    }
    if (source.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} source platform mismatch`, {
        source_wallet_id: cmd.sourceWalletId,
        currency_code: source.currencyCode,
        expected_platform_id: cmd.platformId,
        actual_platform_id: source.platformId,
      });
      throw ErrWalletNotFound(cmd.sourceWalletId);
    }

    const target = await this.walletRepo.findById(ctx, cmd.targetWalletId);
    if (!target) {
      this.logger.warn(ctx, `${methodLogTag} target wallet not found`, {
        target_wallet_id: cmd.targetWalletId,
      });
      throw ErrWalletNotFound(cmd.targetWalletId);
    }
    if (target.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} target platform mismatch`, {
        target_wallet_id: cmd.targetWalletId,
        currency_code: source.currencyCode,
        expected_platform_id: cmd.platformId,
        actual_platform_id: target.platformId,
      });
      throw ErrWalletNotFound(cmd.targetWalletId);
    }

    if (source.currencyCode !== target.currencyCode) {
      this.logger.warn(ctx, `${methodLogTag} currency mismatch`, {
        source_wallet_id: source.id,
        source_currency: source.currencyCode,
        target_wallet_id: target.id,
        target_currency: target.currencyCode,
      });
      throw ErrCurrencyMismatch();
    }

    const now = Date.now();
    const sourceTxId = this.idGen.newId();
    const targetTxId = this.idGen.newId();

    const activeHolds = await this.holdRepo.sumActiveHolds(ctx, source.id);
    const availableBalance = source.cachedBalanceMinor - activeHolds;

    this.logger.debug(ctx, `${methodLogTag} source balance check`, {
      source_wallet_id: source.id,
      currency_code: source.currencyCode,
      cached_balance_minor: Number(source.cachedBalanceMinor),
      active_holds_minor: Number(activeHolds),
      available_balance_minor: Number(availableBalance),
    });

    source.withdraw(cmd.amountMinor, availableBalance, now);
    target.deposit(cmd.amountMinor, now);

    const outTx = Transaction.create({
      id: sourceTxId,
      walletId: source.id,
      counterpartWalletId: target.id,
      type: "transfer_out",
      amountMinor: cmd.amountMinor,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: now,
    });

    const inTx = Transaction.create({
      id: targetTxId,
      walletId: target.id,
      counterpartWalletId: source.id,
      type: "transfer_in",
      amountMinor: cmd.amountMinor,
      status: "completed",
      idempotencyKey: null,
      reference: cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: now,
    });

    const debitEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: sourceTxId,
      walletId: source.id,
      entryType: "DEBIT",
      amountMinor: -cmd.amountMinor,
      balanceAfterMinor: source.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    const creditEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: targetTxId,
      walletId: target.id,
      entryType: "CREDIT",
      amountMinor: cmd.amountMinor,
      balanceAfterMinor: target.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    // Wallets saved in deterministic ID order to prevent deadlocks:
    // concurrent transfers A→B and B→A both lock the lower-ID wallet first,
    // so the lock cycle that causes deadlock cannot form.
    const [first, second] = source.id < target.id ? [source, target] : [target, source];
    await this.walletRepo.save(ctx, first);
    await this.walletRepo.save(ctx, second);
    await this.transactionRepo.saveMany(ctx, [outTx, inTx]);
    await this.ledgerEntryRepo.saveMany(ctx, [debitEntry, creditEntry]);

    this.logger.info(ctx, `${methodLogTag} transfer success`, {
      source_wallet_id: cmd.sourceWalletId,
      target_wallet_id: cmd.targetWalletId,
      currency_code: source.currencyCode,
      source_transaction_id: sourceTxId,
      target_transaction_id: targetTxId,
      amount_minor: Number(cmd.amountMinor),
    });

    return {
      sourceTransactionId: sourceTxId,
      targetTransactionId: targetTxId,
      movementId: movement.id,
    };
  }
}
