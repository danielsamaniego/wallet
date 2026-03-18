import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/entity.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { Transaction } from "../../../domain/transaction/entity.js";
import { ErrSystemWalletNotFound, ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface DepositCommand {
  walletId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface DepositResult {
  transactionId: string;
}

const mainLogTag = "DepositHandler";

export class DepositHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: DepositCommand): Promise<DepositResult> {
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
      await repos.wallets.save(wallet);
      await repos.wallets.save(systemWallet);
      await repos.transactions.save(tx);
      await repos.ledgerEntries.saveMany([creditEntry, debitEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} deposit success`, {
      wallet_id: cmd.walletId,
      transaction_id: txId,
      amount_cents: Number(cmd.amountCents),
    });

    return { transactionId: txId };
  }
}
