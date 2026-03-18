import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/entity.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { Transaction } from "../../../domain/transaction/entity.js";
import {
  ErrCurrencyMismatch,
  ErrSameWallet,
  ErrWalletNotFound,
} from "../../../domain/wallet/errors.js";

export interface TransferCommand {
  sourceWalletId: string;
  targetWalletId: string;
  amountCents: bigint;
  reference?: string;
  idempotencyKey: string;
}

export interface TransferResult {
  sourceTransactionId: string;
  targetTransactionId: string;
}

const mainLogTag = "TransferHandler";

export class TransferHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: TransferCommand): Promise<TransferResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    if (cmd.sourceWalletId === cmd.targetWalletId) {
      throw ErrSameWallet();
    }

    const sourceTxId = this.idGen.newId();
    const targetTxId = this.idGen.newId();

    await this.uow.run(async (repos) => {
      const source = await repos.wallets.findById(cmd.sourceWalletId);
      if (!source) {
        throw ErrWalletNotFound(cmd.sourceWalletId);
      }

      const target = await repos.wallets.findById(cmd.targetWalletId);
      if (!target) {
        throw ErrWalletNotFound(cmd.targetWalletId);
      }

      if (source.currencyCode !== target.currencyCode) {
        throw ErrCurrencyMismatch();
      }

      const now = Date.now();

      // Available balance for source
      const activeHolds = await repos.holds.sumActiveHolds(source.id);
      const availableBalance = source.cachedBalanceCents - activeHolds;

      // Mutate
      source.withdraw(cmd.amountCents, availableBalance, now);
      target.deposit(cmd.amountCents, now);

      // Transactions
      const outTx = Transaction.create({
        id: sourceTxId,
        walletId: source.id,
        counterpartWalletId: target.id,
        type: "transfer_out",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: cmd.idempotencyKey,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      const inTx = Transaction.create({
        id: targetTxId,
        walletId: target.id,
        counterpartWalletId: source.id,
        type: "transfer_in",
        amountCents: cmd.amountCents,
        status: "completed",
        idempotencyKey: null,
        reference: cmd.reference ?? null,
        metadata: null,
        holdId: null,
        createdAt: now,
      });

      // Ledger entries: 1 DEBIT on source (transfer_out), 1 CREDIT on target (transfer_in)
      const debitEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: sourceTxId,
        walletId: source.id,
        entryType: "DEBIT",
        amountCents: -cmd.amountCents,
        balanceAfterCents: source.cachedBalanceCents,
        createdAt: now,
      });

      const creditEntry = LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: targetTxId,
        walletId: target.id,
        entryType: "CREDIT",
        amountCents: cmd.amountCents,
        balanceAfterCents: target.cachedBalanceCents,
        createdAt: now,
      });

      await repos.wallets.save(source);
      await repos.wallets.save(target);
      await repos.transactions.saveMany([outTx, inTx]);
      await repos.ledgerEntries.saveMany([debitEntry, creditEntry]);
    });

    this.logger.info(ctx, `${methodLogTag} transfer success`, {
      source_wallet_id: cmd.sourceWalletId,
      target_wallet_id: cmd.targetWalletId,
      source_transaction_id: sourceTxId,
      target_transaction_id: targetTxId,
      amount_cents: Number(cmd.amountCents),
    });

    return { sourceTransactionId: sourceTxId, targetTransactionId: targetTxId };
  }
}
