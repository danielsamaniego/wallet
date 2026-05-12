import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { CaptureHoldCommand, CaptureHoldResult } from "./command.js";

const mainLogTag = "CaptureHoldService";

/**
 * Business core of capturing an active hold. Re-loads the hold + wallet
 * inside the open transaction, expires the hold on access if its TTL passed,
 * otherwise captures it and writes the matching transaction and ledger
 * entries. Shared by `CaptureHoldUseCase` (sync path) and the Phase 2 async
 * worker.
 *
 * The caller MUST have already performed the pre-lock platform-ownership
 * guard and acquired the per-wallet lock + transaction before invoking
 * `execute`.
 */
export class CaptureHoldService {
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
    cmd: CaptureHoldCommand,
    movement: Movement,
  ): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | execute`;

    const hold = await this.holdRepo.findById(ctx, cmd.holdId);
    if (!hold) {
      this.logger.warn(ctx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
      throw ErrHoldNotFound(cmd.holdId);
    }

    // Wallet re-read inside the tx. Platform ownership was validated in the
    // pre-lock guard owned by the use case; here we only defend against the
    // wallet being deleted in the tiny window between pre-lock and tx start
    // (theoretical; no current API deletes wallets).
    const wallet = await this.walletRepo.findById(ctx, hold.walletId);
    if (!wallet) {
      this.logger.warn(ctx, `${methodLogTag} wallet disappeared after pre-lock`, {
        wallet_id: hold.walletId,
      });
      throw ErrWalletNotFound(hold.walletId);
    }

    const now = Date.now();
    const txId = this.idGen.newId();

    if (hold.isExpired(now)) {
      this.logger.info(ctx, `${methodLogTag} hold expired on access`, {
        hold_id: hold.id,
        wallet_id: hold.walletId,
        currency_code: wallet.currencyCode,
        expires_at: hold.expiresAt,
      });
      hold.expire(now);
      try {
        await this.holdRepo.transitionStatus(ctx, hold.id, "active", "expired", now);
      } catch {
        /* already expired/changed by another process — that's fine */
      }
      throw ErrHoldExpired(cmd.holdId);
    }

    hold.capture(now);
    wallet.withdraw(hold.amountMinor, wallet.cachedBalanceMinor, now);

    const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
    const systemSide = await this.walletRepo.adjustSystemShardBalance(
      ctx,
      wallet.platformId,
      wallet.currencyCode,
      shardIndex,
      hold.amountMinor,
      now,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: "hold_capture",
      amountMinor: hold.amountMinor,
      status: "completed",
      idempotencyKey: cmd.idempotencyKey,
      reference: hold.reference,
      metadata: null,
      holdId: hold.id,
      movementId: movement.id,
      createdAt: now,
    });

    const debitEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: wallet.id,
      entryType: "DEBIT",
      amountMinor: -hold.amountMinor,
      balanceAfterMinor: wallet.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    const creditEntry = LedgerEntry.create({
      id: this.idGen.newId(),
      transactionId: txId,
      walletId: systemSide.walletId,
      entryType: "CREDIT",
      amountMinor: hold.amountMinor,
      balanceAfterMinor: systemSide.cachedBalanceMinor,
      movementId: movement.id,
      createdAt: now,
    });

    await this.holdRepo.transitionStatus(ctx, hold.id, "active", "captured", now);
    await this.walletRepo.save(ctx, wallet);
    await this.transactionRepo.save(ctx, tx);
    await this.ledgerEntryRepo.saveMany(ctx, [debitEntry, creditEntry]);

    this.logger.info(ctx, `${methodLogTag} hold captured`, {
      hold_id: cmd.holdId,
      currency_code: wallet.currencyCode,
      transaction_id: txId,
    });

    return { transactionId: txId, movementId: movement.id };
  }
}
