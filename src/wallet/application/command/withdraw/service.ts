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
import type { WithdrawCommand, WithdrawResult } from "./command.js";

const mainLogTag = "WithdrawService";

/**
 * Business core of a withdrawal. Shared by `WithdrawUseCase` (sync path) and
 * the Phase 2 async worker. Must be called inside an open transaction and
 * with the per-wallet lock already acquired; the caller is also responsible
 * for having persisted `movement`.
 */
export class WithdrawService {
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
    cmd: WithdrawCommand,
    movement: Movement,
  ): Promise<WithdrawResult> {
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

    const activeHolds = await this.holdRepo.sumActiveHolds(ctx, wallet.id);
    const availableBalance = wallet.cachedBalanceMinor - activeHolds;

    this.logger.debug(ctx, `${methodLogTag} balance check`, {
      wallet_id: wallet.id,
      currency_code: wallet.currencyCode,
      cached_balance_minor: Number(wallet.cachedBalanceMinor),
      active_holds_minor: Number(activeHolds),
      available_balance_minor: Number(availableBalance),
    });

    wallet.withdraw(cmd.amountMinor, availableBalance, now);

    const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
    const systemSide = await this.walletRepo.adjustSystemShardBalance(
      ctx,
      wallet.platformId,
      wallet.currencyCode,
      shardIndex,
      cmd.amountMinor,
      now,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: "withdrawal",
      amountMinor: cmd.amountMinor,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId: movement.id,
      createdAt: now,
    });

    const debitEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: wallet.id,
      entryType: "DEBIT",
      amountMinor: -cmd.amountMinor,
      balanceAfterMinor: wallet.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    const creditEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: systemSide.walletId,
      entryType: "CREDIT",
      amountMinor: cmd.amountMinor,
      balanceAfterMinor: systemSide.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    await this.walletRepo.save(ctx, wallet);
    await this.transactionRepo.save(ctx, tx);
    await this.ledgerEntryRepo.saveMany(ctx, [debitEntry, creditEntry]);

    this.logger.info(ctx, `${methodLogTag} withdrawal success`, {
      wallet_id: cmd.walletId,
      currency_code: wallet.currencyCode,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId: movement.id };
  }
}
