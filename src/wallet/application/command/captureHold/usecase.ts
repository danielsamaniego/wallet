import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
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
  ) {}

  async handle(ctx: AppContext, cmd: CaptureHoldCommand): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

    await this.txManager.run(ctx, async (txCtx) => {
      const hold = await this.holdRepo.findById(txCtx, cmd.holdId);
      if (!hold) {
        this.logger.warn(txCtx, `${methodLogTag} hold not found`, { hold_id: cmd.holdId });
        throw ErrHoldNotFound(cmd.holdId);
      }

      const wallet = await this.walletRepo.findById(txCtx, hold.walletId);
      if (!wallet) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: hold.walletId });
        throw ErrWalletNotFound(hold.walletId);
      }
      walletCurrency = wallet.currencyCode;
      if (wallet.platformId !== cmd.platformId) {
        this.logger.warn(txCtx, `${methodLogTag} platform mismatch`, {
          wallet_id: hold.walletId,
          currency_code: wallet.currencyCode,
          expected_platform_id: cmd.platformId,
          actual_platform_id: wallet.platformId,
        });
        throw ErrWalletNotFound(hold.walletId);
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

      // Check hold expiration on-access
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

      // Capture hold
      hold.capture(now);

      // Create movement (journal entry)
      const movement = Movement.create({ id: movementId, type: "hold_capture", createdAt: now });

      // Debit user wallet
      wallet.withdraw(hold.amountMinor, wallet.cachedBalanceMinor, now);

      // System wallet: compute snapshot for ledger entry (approximate under concurrency)
      const systemBalanceAfter = systemWallet.cachedBalanceMinor + hold.amountMinor;

      const tx = Transaction.create({
        id: txId,
        walletId: wallet.id,
        counterpartWalletId: systemWallet.id,
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
        walletId: systemWallet.id,
        entryType: "CREDIT",
        amountMinor: hold.amountMinor,
        balanceAfterMinor: systemBalanceAfter,
        movementId,
        createdAt: now,
      });

      // Persist (movement first — FK constraint)
      await this.movementRepo.save(txCtx, movement);
      await this.holdRepo.transitionStatus(txCtx, hold.id, "active", "captured", now);
      await this.walletRepo.save(txCtx, wallet);
      await this.walletRepo.adjustSystemWalletBalance(
        txCtx,
        systemWallet.id,
        hold.amountMinor,
        now,
      );
      await this.transactionRepo.save(txCtx, tx);
      await this.ledgerEntryRepo.saveMany(txCtx, [debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} hold captured`, {
      hold_id: cmd.holdId,
      currency_code: walletCurrency,
      transaction_id: txId,
    });

    return { transactionId: txId, movementId };
  }
}
