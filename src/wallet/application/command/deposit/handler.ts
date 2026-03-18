import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { IIDGenerator } from "../../../../shared/domain/kernel/id.generator.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { ITransactionManager } from "../../../domain/ports/transaction.manager.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import {
  ErrSystemWalletNotFound,
  ErrWalletNotFound,
} from "../../../domain/wallet/wallet.errors.js";
import type { DepositCommand, DepositResult } from "./command.js";

const mainLogTag = "DepositHandler";

export class DepositHandler {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: DepositCommand): Promise<DepositResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_cents: Number(cmd.amountCents),
    });

    const txId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
      if (!wallet) throw ErrWalletNotFound(cmd.walletId);
      if (wallet.platformId !== cmd.platformId) throw ErrWalletNotFound(cmd.walletId);

      const systemWallet = await this.walletRepo.findSystemWallet(
        txCtx,
        wallet.platformId,
        wallet.currencyCode,
      );
      if (!systemWallet) throw ErrSystemWalletNotFound(wallet.platformId, wallet.currencyCode);

      const now = Date.now();

      // Mutate aggregates
      wallet.deposit(cmd.amountCents, now);
      systemWallet.withdraw(cmd.amountCents, 0n, now); // System wallet: no balance check

      // Create transaction
      const tx = Transaction.create({
        id: txId,
        walletId: wallet.id,
        counterpartWalletId: systemWallet.id,
        type: "deposit",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      // Create ledger entries (CREDIT user wallet, DEBIT system wallet)
      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: wallet.id,
        entryType: "CREDIT",
        amountCents: cmd.amountCents,
        balanceAfterCents: wallet.cachedBalanceCents,
        createdAt: now,
      });

      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: systemWallet.id,
        entryType: "DEBIT",
        amountCents: -cmd.amountCents,
        balanceAfterCents: systemWallet.cachedBalanceCents,
        createdAt: now,
      });

      // Persist
      await this.walletRepo.save(txCtx, wallet);
      await this.walletRepo.save(txCtx, systemWallet);
      await this.transactionRepo.save(txCtx, tx);
      await this.ledgerEntryRepo.saveMany(txCtx, [creditEntry, debitEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} deposit success`, {
      wallet_id: cmd.walletId,
      transaction_id: txId,
      amount_cents: Number(cmd.amountCents),
    });

    return { transactionId: txId };
  }
}
