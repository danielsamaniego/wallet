import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { CaptureHoldCommand, CaptureHoldResult } from "./command.js";

const mainLogTag = "CaptureHoldUseCase";

export class CaptureHoldUseCase implements ICommandHandler<CaptureHoldCommand, CaptureHoldResult> {
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

  async handle(ctx: AppContext, cmd: CaptureHoldCommand): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    const holdForKey = await this.holdRepo.findById(ctx, cmd.holdId);
    if (!holdForKey) {
      this.logger.warn(ctx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
      throw ErrHoldNotFound(cmd.holdId);
    }

    const walletForKey = await this.walletRepo.findById(ctx, holdForKey.walletId);
    if (!walletForKey || walletForKey.platformId !== cmd.platformId) {
      this.logger.warn(ctx, `${methodLogTag} cross-tenant pre-lock rejection`, {
        hold_id: cmd.holdId,
        wallet_id: holdForKey.walletId,
        expected_platform_id: cmd.platformId,
        actual_platform_id: walletForKey?.platformId,
      });
      throw ErrHoldNotFound(cmd.holdId);
    }

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

    await this.lockRunner.run(ctx, [`wallet-lock:${holdForKey.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const hold = await this.holdRepo.findById(txCtx, cmd.holdId);
        if (!hold) {
          this.logger.warn(txCtx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
          throw ErrHoldNotFound(cmd.holdId);
        }

        // Wallet re-read inside the tx. Platform ownership was validated in
        // the pre-lock guard and platformId is immutable, so we only defend
        // against the wallet being deleted in the tiny window between
        // pre-lock and tx start (theoretical; no current API deletes wallets).
        const wallet = await this.walletRepo.findById(txCtx, hold.walletId);
        if (!wallet) {
          this.logger.warn(txCtx, `${methodLogTag} wallet disappeared after pre-lock`, {
            wallet_id: hold.walletId,
          });
          throw ErrWalletNotFound(hold.walletId);
        }
        walletCurrency = wallet.currencyCode;

        const now = Date.now();

        if (hold.isExpired(now)) {
          this.logger.info(txCtx, `${methodLogTag} hold expired on access`, {
            hold_id: hold.id,
            wallet_id: hold.walletId,
            currency_code: wallet.currencyCode,
            expires_at: hold.expiresAt,
          });
          hold.expire(now);
          try {
            await this.holdRepo.transitionStatus(txCtx, hold.id, "active", "expired", now);
          } catch {
            /* already expired/changed by another process — that's fine */
          }
          throw ErrHoldExpired(cmd.holdId);
        }

        hold.capture(now);

        const movement = Movement.create({ id: movementId, type: "hold_capture", createdAt: now });

        wallet.withdraw(hold.amountMinor, wallet.cachedBalanceMinor, now);

        const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
        const systemSide = await this.walletRepo.adjustSystemShardBalance(
          txCtx,
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
          movementId,
          createdAt: now,
        });

        const debitEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: wallet.id,
          entryType: "DEBIT",
          amountMinor: -hold.amountMinor,
          balanceAfterMinor: wallet.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        const creditEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: systemSide.walletId,
          entryType: "CREDIT",
          amountMinor: hold.amountMinor,
          balanceAfterMinor: systemSide.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        // movement first: ledger_entries.movement_id FK requires it
        await this.movementRepo.save(txCtx, movement);
        await this.holdRepo.transitionStatus(txCtx, hold.id, "active", "captured", now);
        await this.walletRepo.save(txCtx, wallet);
        await this.transactionRepo.save(txCtx, tx);
        await this.ledgerEntryRepo.saveMany(txCtx, [debitEntry, creditEntry]);
      });
    });

    this.logger.info(ctx, `${methodLogTag} hold captured`, {
      hold_id: cmd.holdId,
      currency_code: walletCurrency,
      transaction_id: txId,
    });

    return { transactionId: txId, movementId };
  }
}
