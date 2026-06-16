import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement, type MovementType } from "../../../domain/movement/movement.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import {
  Transaction,
  type TransactionType,
} from "../../../domain/transaction/transaction.entity.js";
import type { Wallet } from "../../../domain/wallet/wallet.aggregate.js";
import {
  ErrCurrencyMismatch,
  ErrInvalidBatchOperations,
  ErrWalletNotFound,
} from "../../../domain/wallet/wallet.errors.js";
import type {
  ApplyBatchOperationsCommand,
  ApplyBatchOperationsResult,
  BatchOperation,
} from "./command.js";

const mainLogTag = "ApplyBatchOperationsUseCase";

/** Signed balance delta an operation applies (adjust carries its own sign). */
function signedAmountOf(op: BatchOperation): bigint {
  switch (op.type) {
    case "deposit":
      return op.amountMinor;
    case "withdraw":
    case "charge":
      return -op.amountMinor;
    default:
      return op.amountMinor; // adjust: already signed
  }
}

/**
 * Deterministic apply order, independent of how the caller interleaves the
 * operations: credits first (so a debit can draw on a sibling credit), then
 * fund-requiring debits (charge / withdraw, which must stay non-negative), then
 * balance-reducing adjusts last (the only op allowed to go negative). This
 * guarantees a negative `adjust` never spuriously starves a sibling charge, and
 * the outcome does not depend on the request ordering.
 */
function applyOrder(op: BatchOperation): number {
  if (signedAmountOf(op) > 0n) {
    return 0; // credits: deposit, positive adjust
  }
  if (op.type === "adjust") {
    return 2; // balance-reducing adjustment: applied last
  }
  return 1; // fund-requiring debit: charge, withdraw
}

/** The movement type recorded for an operation. */
function movementTypeOf(op: BatchOperation): MovementType {
  switch (op.type) {
    case "deposit":
      return "deposit";
    case "withdraw":
      return "withdrawal";
    case "charge":
      return "charge";
    default:
      return "adjustment";
  }
}

/** The transaction type recorded for an operation (adjust splits by sign). */
function transactionTypeOf(op: BatchOperation): TransactionType {
  switch (op.type) {
    case "deposit":
      return "deposit";
    case "withdraw":
      return "withdrawal";
    case "charge":
      return "charge";
    default:
      return op.amountMinor > 0n ? "adjustment_credit" : "adjustment_debit";
  }
}

interface PlannedOperation {
  op: BatchOperation;
  movementId: string;
  txId: string;
}

export class ApplyBatchOperationsUseCase
  implements ICommandHandler<ApplyBatchOperationsCommand, ApplyBatchOperationsResult>
{
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

  async handle(
    ctx: AppContext,
    cmd: ApplyBatchOperationsCommand,
  ): Promise<ApplyBatchOperationsResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      operation_count: cmd.operations.length,
      wallet_ids: cmd.operations.map((o) => o.walletId),
    });

    if (cmd.operations.length < 2) {
      this.logger.warn(ctx, `${methodLogTag} too few operations`, {
        operation_count: cmd.operations.length,
      });
      throw ErrInvalidBatchOperations("a batch requires at least two operations");
    }

    // Pre-generate movement + transaction ids in REQUEST order so the response
    // preserves order regardless of the credit-before-debit apply order.
    const plan: PlannedOperation[] = cmd.operations.map((op) => ({
      op,
      movementId: this.idGen.newId(),
      txId: this.idGen.newId(),
    }));
    const operations = plan.map((p) => ({ movementId: p.movementId, transactionId: p.txId }));
    // Only the first operation (request order) carries the idempotency key — the
    // transaction column is unique per platform; whole-batch replay dedup is the
    // idempotency middleware's job.
    const keyedTxId = plan[0]?.txId;

    // Pre-flight OUTSIDE the lock: validate existence + ownership + currency so
    // we never acquire a lock on a wallet the caller does not own — locking an
    // unvalidated cross-tenant key is a contention DoS vector (AGENTS.md). The
    // runner sorts + dedupes the keys so concurrent batches can never deadlock.
    const walletIds = await this.resolveOwnedWalletIds(ctx, cmd);
    const lockKeys = walletIds.map((id) => `wallet-lock:${id}`);

    await this.lockRunner.run(ctx, lockKeys, async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const now = Date.now();
        // Authoritative reload UNDER the lock so each optimistic-locking retry
        // sees the fresh balance/version.
        const { wallets, holds } = await this.loadWalletsAndHolds(txCtx, walletIds);

        // By default apply in a deterministic order (credits → fund-requiring
        // debits → balance-reducing adjusts); a stable sort keeps each wallet's
        // ops in request order within a tier. When the caller opts into
        // preserveOperationOrder, apply in the exact request order instead.
        const ordered = cmd.preserveOperationOrder
          ? plan
          : [...plan].sort((a, b) => applyOrder(a.op) - applyOrder(b.op));

        for (const planned of ordered) {
          await this.applyOne(txCtx, cmd, planned, wallets, holds, now, keyedTxId);
        }
      });
    });

    this.logger.info(ctx, `${methodLogTag} batch applied`, {
      operation_count: cmd.operations.length,
    });

    return { operations };
  }

  /**
   * Pre-flight validation (read-only, OUTSIDE the lock): each distinct wallet
   * must exist, belong to the calling platform, not be a system wallet, and
   * share one currency. Returns the distinct wallet ids (request order) used to
   * build the lock keys, so a lock is only ever taken on a validated, owned
   * wallet. Throws before any lock on the first invalid wallet.
   */
  private async resolveOwnedWalletIds(
    ctx: AppContext,
    cmd: ApplyBatchOperationsCommand,
  ): Promise<string[]> {
    const methodLogTag = `${mainLogTag} | resolveOwnedWalletIds`;
    const ids: string[] = [];
    const seen = new Set<string>();
    let currency = "";

    for (const op of cmd.operations) {
      if (seen.has(op.walletId)) {
        continue;
      }
      seen.add(op.walletId);
      const wallet = await this.walletRepo.findById(ctx, op.walletId);
      if (!wallet || wallet.isSystem || wallet.platformId !== cmd.platformId) {
        this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: op.walletId });
        throw ErrWalletNotFound(op.walletId);
      }
      if (currency === "") {
        currency = wallet.currencyCode;
      } else if (wallet.currencyCode !== currency) {
        this.logger.warn(ctx, `${methodLogTag} currency mismatch`, {
          wallet_id: op.walletId,
          expected_currency: currency,
          actual_currency: wallet.currencyCode,
        });
        throw ErrCurrencyMismatch();
      }
      ids.push(op.walletId);
    }

    return ids;
  }

  /**
   * Authoritative load UNDER the lock: fetch a fresh aggregate + active holds
   * for each (already-validated) wallet id. No re-validation — platform,
   * currency and system flags are immutable, and the wallet cannot be deleted
   * while it has ledger entries; the existence check is purely defensive.
   */
  private async loadWalletsAndHolds(
    txCtx: AppContext,
    walletIds: string[],
  ): Promise<{ wallets: Map<string, Wallet>; holds: Map<string, bigint> }> {
    const methodLogTag = `${mainLogTag} | loadWalletsAndHolds`;
    const wallets = new Map<string, Wallet>();
    const holds = new Map<string, bigint>();

    for (const id of walletIds) {
      const wallet = await this.walletRepo.findById(txCtx, id);
      if (!wallet) {
        this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: id });
        throw ErrWalletNotFound(id);
      }
      wallets.set(id, wallet);
      holds.set(id, await this.holdRepo.sumActiveHolds(txCtx, id));
    }

    return { wallets, holds };
  }

  /**
   * Apply a single operation, mirroring the standalone deposit/charge/withdraw/
   * adjust use cases: mutate the wallet, persist it, move the system shard, and
   * write the movement + transaction + double-entry ledger pair. Persisting per
   * operation (rather than batching all balance writes then all entries) is
   * required by the ledger triggers, which check, on every entry insert, that the
   * wallet's cached balance already equals that entry's `balance_after` and that
   * the entry chains off the previous one. Each wallet save bumps the version by
   * exactly one, satisfying optimistic locking; the whole batch is serialized by
   * the lock + transaction.
   */
  private async applyOne(
    txCtx: AppContext,
    cmd: ApplyBatchOperationsCommand,
    planned: PlannedOperation,
    wallets: Map<string, Wallet>,
    holds: Map<string, bigint>,
    now: number,
    keyedTxId: string | undefined,
  ): Promise<void> {
    const { op, movementId, txId } = planned;
    const wallet = wallets.get(op.walletId) as Wallet;
    const available = wallet.cachedBalanceMinor - (holds.get(op.walletId) as bigint);
    const signed = signedAmountOf(op);
    const credit = signed > 0n;
    const magnitude = credit ? signed : -signed;

    // Mutate the wallet via the matching domain rule, then persist it so its
    // cached balance equals the ledger entry's balance_after before the insert.
    switch (op.type) {
      case "deposit":
        wallet.deposit(op.amountMinor, now);
        break;
      case "withdraw":
      case "charge":
        wallet.withdraw(op.amountMinor, available, now);
        break;
      default:
        // adjust: signed amount, honours the platform's negative-balance policy.
        wallet.adjust(op.amountMinor, available, cmd.allowNegativeBalance, now);
    }

    const movement = Movement.create({
      id: movementId,
      type: movementTypeOf(op),
      // adjustments carry a reason on the movement, like the single-op path
      // (Movement.create normalises undefined → null).
      reason: op.type === "adjust" ? op.reason : null,
      createdAt: now,
    });
    await this.movementRepo.save(txCtx, movement);
    await this.walletRepo.save(txCtx, wallet);

    const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
    const systemSide = await this.walletRepo.adjustSystemShardBalance(
      txCtx,
      wallet.platformId,
      wallet.currencyCode,
      shardIndex,
      -signed,
      now,
    );

    const tx = Transaction.create({
      id: txId,
      walletId: wallet.id,
      counterpartWalletId: systemSide.walletId,
      type: transactionTypeOf(op),
      amountMinor: magnitude,
      status: "completed",
      idempotencyKey: txId === keyedTxId ? cmd.idempotencyKey : null,
      reference: op.reason ?? cmd.reference ?? null,
      metadata: cmd.metadata ?? null,
      holdId: null,
      movementId,
      createdAt: now,
    });
    await this.transactionRepo.save(txCtx, tx);

    await this.ledgerEntryRepo.saveMany(txCtx, [
      LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: wallet.id,
        entryType: credit ? "CREDIT" : "DEBIT",
        amountMinor: signed,
        balanceAfterMinor: wallet.cachedBalanceMinor,
        movementId,
        createdAt: now,
      }),
      LedgerEntry.create({
        id: this.idGen.newId(),
        transactionId: txId,
        walletId: systemSide.walletId,
        entryType: credit ? "DEBIT" : "CREDIT",
        amountMinor: -signed,
        balanceAfterMinor: systemSide.cachedBalanceMinor,
        movementId,
        createdAt: now,
      }),
    ]);
  }
}
