import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { ErrHoldExpired, ErrHoldNotFound } from "../../../domain/hold/hold.errors.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import {
  ErrSystemWalletNotFound,
  ErrWalletNotFound,
} from "../../../domain/wallet/wallet.errors.js";
import type { CaptureHoldCommand, CaptureHoldResult } from "./command.js";

const mainLogTag = "CaptureHoldHandler";

export class CaptureHoldHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly holdRepo: IHoldRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: CaptureHoldCommand): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { hold_id: cmd.holdId });

    const txId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      const hold = await this.holdRepo.findById(txCtx, cmd.holdId);
      if (!hold) {
        throw ErrHoldNotFound(cmd.holdId);
      }

      const wallet = await this.walletRepo.findById(txCtx, hold.walletId);
      if (!wallet) throw ErrWalletNotFound(hold.walletId);
      if (wallet.platformId !== cmd.platformId) throw ErrWalletNotFound(hold.walletId);

      const systemWallet = await this.walletRepo.findSystemWallet(
        txCtx,
        wallet.platformId,
        wallet.currencyCode,
      );
      if (!systemWallet) throw ErrSystemWalletNotFound(wallet.platformId, wallet.currencyCode);

      const now = Date.now();

      // Check hold expiration on-access
      if (hold.isExpired(now)) {
        this.logger.info(txCtx, `${methodLogTag} hold expired on access`, {
          hold_id: hold.id,
          wallet_id: hold.walletId,
          expires_at: hold.expiresAt,
        });
        hold.expire(now);
        await this.holdRepo.save(txCtx, hold);
        throw ErrHoldExpired(cmd.holdId);
      }

      // Capture hold
      hold.capture(now);

      // Debit wallet, credit system wallet
      wallet.withdraw(hold.amountCents, hold.amountCents, now);
      systemWallet.deposit(hold.amountCents, now);

      const tx = Transaction.create({
        id: txId,
        walletId: wallet.id,
        counterpartWalletId: systemWallet.id,
        type: "hold_capture",
        amountCents: hold.amountCents,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: hold.reference,
        metadata: null,
        holdId: hold.id,
        createdAt: now,
      });

      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: wallet.id,
        entryType: "DEBIT",
        amountCents: -hold.amountCents,
        balanceAfterCents: wallet.cachedBalanceCents,
        createdAt: now,
      });

      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: systemWallet.id,
        entryType: "CREDIT",
        amountCents: hold.amountCents,
        balanceAfterCents: systemWallet.cachedBalanceCents,
        createdAt: now,
      });

      await this.holdRepo.save(txCtx, hold);
      await this.walletRepo.save(txCtx, wallet);
      await this.walletRepo.save(txCtx, systemWallet);
      await this.transactionRepo.save(txCtx, tx);
      await this.ledgerEntryRepo.saveMany(txCtx, [debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} hold captured`, {
      hold_id: cmd.holdId,
      transaction_id: txId,
    });

    return { transactionId: txId };
  }
}
