import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { ErrHoldNotFound } from "../../../domain/hold/errors.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/entity.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { Transaction } from "../../../domain/transaction/entity.js";
import { ErrSystemWalletNotFound, ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface CaptureHoldCommand {
  holdId: string;
  idempotencyKey: string;
}

export interface CaptureHoldResult {
  transactionId: string;
}

const mainLogTag = "CaptureHoldHandler";

export class CaptureHoldHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: CaptureHoldCommand): Promise<CaptureHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    const txId = this.idGen.newId();

    await this.uow.run(async (repos) => {
      const hold = await repos.holds.findById(cmd.holdId);
      if (!hold) {
        throw ErrHoldNotFound(cmd.holdId);
      }

      const wallet = await repos.wallets.findById(hold.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(hold.walletId);
      }

      const systemWallet = await repos.wallets.findSystemWallet(
        wallet.platformId,
        wallet.currencyCode,
      );
      if (!systemWallet) {
        throw ErrSystemWalletNotFound(wallet.platformId, wallet.currencyCode);
      }

      const now = Date.now();

      // Check hold expiration on-access
      if (hold.isExpired(now)) {
        hold.expire(now);
        await repos.holds.save(hold);
        throw ErrHoldNotFound(cmd.holdId);
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

      await repos.holds.save(hold);
      await repos.wallets.save(wallet);
      await repos.wallets.save(systemWallet);
      await repos.transactions.save(tx);
      await repos.ledgerEntries.saveMany([debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} hold captured`, {
      hold_id: cmd.holdId,
      transaction_id: txId,
    });

    return { transactionId: txId };
  }
}
