import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { Movement } from "../../../domain/movement/movement.entity.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { DepositCommand, DepositResult } from "./command.js";

const mainLogTag = "DepositService";

/**
 * Pure business logic for a deposit, shared by the sync `DepositUseCase` (which
 * creates a fresh `posted` Movement before calling `execute`) and by the async
 * worker (Phase 2 — which transitions an existing `pending` Movement to
 * `posted` before calling `execute`).
 *
 * Contract:
 *   - The caller MUST run `execute` inside an already-open transaction
 *     (`txCtx`) and an already-acquired per-wallet lock. The service does not
 *     own these concerns.
 *   - The caller MUST have persisted `movement` (INSERT for sync, UPDATE for
 *     async transition) inside the same transaction. The service only uses
 *     `movement.id` as the FK for transactions and ledger entries — it never
 *     writes to `movements`.
 *
 * This separation keeps the use case in charge of Movement lifecycle and the
 * lock/tx envelope, while the service keeps all the wallet domain rules in
 * one place that both paths share verbatim.
 */
export class DepositService {
  constructor(
    private readonly walletRepo: IWalletRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async execute(ctx: AppContext, cmd: DepositCommand, movement: Movement): Promise<DepositResult> {
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

    wallet.deposit(cmd.amountMinor, now);

    const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
    const systemSide = await this.walletRepo.adjustSystemShardBalance(
      ctx,
      wallet.platformId,
      wallet.currencyCode,
      shardIndex,
      -cmd.amountMinor,
      now,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: "deposit",
      amountMinor: cmd.amountMinor,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: now,
    });

    const creditEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: wallet.id,
      entryType: "CREDIT",
      amountMinor: cmd.amountMinor,
      balanceAfterMinor: wallet.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    const debitEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: systemSide.walletId,
      entryType: "DEBIT",
      amountMinor: -cmd.amountMinor,
      balanceAfterMinor: systemSide.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    await this.walletRepo.save(ctx, wallet);
    await this.transactionRepo.save(ctx, tx);
    await this.ledgerEntryRepo.saveMany(ctx, [creditEntry, debitEntry]);

    this.logger.info(ctx, `${methodLogTag} deposit success`, {
      wallet_id: cmd.walletId,
      currency_code: wallet.currencyCode,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId: movement.id };
  }
}
