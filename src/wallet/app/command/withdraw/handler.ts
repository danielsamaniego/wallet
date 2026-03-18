import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/entity.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { Transaction } from "../../../domain/transaction/entity.js";
import { ErrSystemWalletNotFound, ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface WithdrawCommand {
  walletId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface WithdrawResult {
  transactionId: string;
}

const mainLogTag = "WithdrawHandler";

export class WithdrawHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: WithdrawCommand): Promise<WithdrawResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    const txId = this.idGen.newId();

    await this.uow.run(async (repos) => {
      const wallet = await repos.wallets.findById(cmd.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      const systemWallet = await repos.wallets.findSystemWallet(
        wallet.platformId,
        wallet.currencyCode,
      );
      if (!systemWallet) {
        throw ErrSystemWalletNotFound(wallet.platformId, wallet.currencyCode);
      }

      const now = Date.now();

      // Calculate available balance (cached - active holds)
      const activeHolds = await repos.holds.sumActiveHolds(wallet.id);
      const availableBalance = wallet.cachedBalanceCents - activeHolds;

      // Mutate aggregates
      wallet.withdraw(cmd.amountCents, availableBalance, now);
      systemWallet.deposit(cmd.amountCents, now);

      // Create transaction
      const tx = Transaction.create({
        id: txId,
        walletId: wallet.id,
        counterpartWalletId: systemWallet.id,
        type: "withdrawal",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      // Ledger entries (DEBIT user wallet, CREDIT system wallet)
      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: wallet.id,
        entryType: "DEBIT",
        amountCents: -cmd.amountCents,
        balanceAfterCents: wallet.cachedBalanceCents,
        createdAt: now,
      });

      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: systemWallet.id,
        entryType: "CREDIT",
        amountCents: cmd.amountCents,
        balanceAfterCents: systemWallet.cachedBalanceCents,
        createdAt: now,
      });

      await repos.wallets.save(wallet);
      await repos.wallets.save(systemWallet);
      await repos.transactions.save(tx);
      await repos.ledgerEntries.saveMany([debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} withdrawal success`, {
      wallet_id: cmd.walletId,
      transaction_id: txId,
      amount_cents: Number(cmd.amountCents),
    });

    return { transactionId: txId };
  }
}
