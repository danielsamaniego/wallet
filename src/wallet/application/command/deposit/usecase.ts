import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import { systemWalletShardIndex } from "../../../../utils/kernel/shard.js";
import { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "../../../domain/movement/movement.entity.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "../../../domain/ports/movement.repository.js";
import type { ITransactionRepository } from "../../../domain/ports/transaction.repository.js";
import type { IWalletRepository } from "../../../domain/ports/wallet.repository.js";
import { Transaction } from "../../../domain/transaction/transaction.entity.js";
import { ErrWalletNotFound } from "../../../domain/wallet/wallet.errors.js";
import type { DepositCommand, DepositResult } from "./command.js";

const mainLogTag = "DepositUseCase";

export class DepositUseCase implements ICommandHandler<DepositCommand, DepositResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly walletRepo: IWalletRepository,
    private readonly transactionRepo: ITransactionRepository,
    private readonly ledgerEntryRepo: ILedgerEntryRepository,
    private readonly movementRepo: IMovementRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
    private readonly lockRunner: LockRunner,
  ) {}

  async handle(ctx: AppContext, cmd: DepositCommand): Promise<DepositResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

    // Serialize concurrent deposits to the same wallet. The lock runner falls
    // through silently if the feature is disabled or the backend is down —
    // the TransactionManager's optimistic-locking retries remain as a safety net.
    await this.lockRunner.run(ctx, [`wallet-lock:${cmd.walletId}`], async () => {
      await this.txManager.run(ctx, async (txCtx) => {
        const wallet = await this.walletRepo.findById(txCtx, cmd.walletId);
        if (!wallet) {
          this.logger.warn(txCtx, `${methodLogTag} wallet not found`, { wallet_id: cmd.walletId });
          throw ErrWalletNotFound(cmd.walletId);
        }
        walletCurrency = wallet.currencyCode;
        if (wallet.platformId !== cmd.platformId) {
          this.logger.warn(txCtx, `${methodLogTag} platform mismatch`, {
            wallet_id: cmd.walletId,
            currency_code: wallet.currencyCode,
            expected_platform_id: cmd.platformId,
            actual_platform_id: wallet.platformId,
          });
          throw ErrWalletNotFound(cmd.walletId);
        }

        const now = Date.now();

        const movement = Movement.create({ id: movementId, type: "deposit", createdAt: now });

        wallet.deposit(cmd.amountMinor, now);

        const shardIndex = systemWalletShardIndex(wallet.id, cmd.systemWalletShardCount);
        const systemSide = await this.walletRepo.adjustSystemShardBalance(
          txCtx,
          wallet.platformId,
          wallet.currencyCode,
          shardIndex,
          -cmd.amountMinor,
          now,
        );

        const tx = Transaction.create({
          id: txId,
          walletId: wallet.id,
          counterpartWalletId: systemSide.walletId,
          type: "deposit",
          amountMinor: cmd.amountMinor,
          status: "completed",
          idempotencyKey: cmd.idempotencyKey,
          reference: cmd.reference ?? null,
          metadata: cmd.metadata ?? null,
          holdId: null,
          movementId,
          createdAt: now,
        });

        const creditEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: wallet.id,
          entryType: "CREDIT",
          amountMinor: cmd.amountMinor,
          balanceAfterMinor: wallet.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        const debitEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: systemSide.walletId,
          entryType: "DEBIT",
          amountMinor: -cmd.amountMinor,
          balanceAfterMinor: systemSide.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        // movement first: ledger_entries.movement_id FK requires it
        await this.movementRepo.save(txCtx, movement);
        await this.walletRepo.save(txCtx, wallet);
        await this.transactionRepo.save(txCtx, tx);
        await this.ledgerEntryRepo.saveMany(txCtx, [creditEntry, debitEntry]);
      });
    });

    this.logger.info(ctx, `${methodLogTag} deposit success`, {
      wallet_id: cmd.walletId,
      currency_code: walletCurrency,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId };
  }
}
