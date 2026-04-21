import type { ICommandHandler } from "../../../../utils/application/cqrs.js";
import type { IIDGenerator } from "../../../../utils/application/id.generator.js";
import type { LockRunner } from "../../../../utils/application/lock.runner.js";
import type { ITransactionManager } from "../../../../utils/application/transaction.manager.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
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
import type { ChargeCommand, ChargeResult } from "./command.js";

const mainLogTag = "ChargeUseCase";

export class ChargeUseCase implements ICommandHandler<ChargeCommand, ChargeResult> {
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

  async handle(ctx: AppContext, cmd: ChargeCommand): Promise<ChargeResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: cmd.walletId,
      amount_minor: Number(cmd.amountMinor),
    });

    const txId = this.idGen.newId();
    const movementId = this.idGen.newId();
    let walletCurrency = "";

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

        // Calculate available balance (cached - active holds)
        const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
        const availableBalance = wallet.cachedBalanceMinor - activeHolds;

        this.logger.debug(txCtx, `${methodLogTag} balance check`, {
          wallet_id: wallet.id,
          currency_code: wallet.currencyCode,
          cached_balance_minor: Number(wallet.cachedBalanceMinor),
          active_holds_minor: Number(activeHolds),
          available_balance_minor: Number(availableBalance),
        });

        // Create movement (journal entry)
        const movement = Movement.create({ id: movementId, type: "charge", createdAt: now });

        // Mutate user wallet aggregate (same rules as withdrawal)
        wallet.withdraw(cmd.amountMinor, availableBalance, now);

        // System wallet: compute snapshot for ledger entry (approximate under concurrency)
        const systemBalanceAfter = systemWallet.cachedBalanceMinor + cmd.amountMinor;

        // Create transaction
        const tx = Transaction.create({
          id: txId,
          walletId: wallet.id,
          counterpartWalletId: systemWallet.id,
          type: "charge",
          amountMinor: cmd.amountMinor,
          status: "completed",
          idempotencyKey: cmd.idempotencyKey,
          reference: cmd.reference ?? null,
          metadata: cmd.metadata ?? null,
          holdId: null,
          movementId,
          createdAt: now,
        });

        // Ledger entries (DEBIT user wallet, CREDIT system wallet)
        const debitEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: wallet.id,
          entryType: "DEBIT",
          amountMinor: -cmd.amountMinor,
          balanceAfterMinor: wallet.cachedBalanceMinor,
          movementId,
          createdAt: now,
        });

        const creditEntry = LedgerEntry.create({
          id: this.idGen.newId(),
          transactionId: txId,
          walletId: systemWallet.id,
          entryType: "CREDIT",
          amountMinor: cmd.amountMinor,
          balanceAfterMinor: systemBalanceAfter,
          movementId,
          createdAt: now,
        });

        // Persist (movement first — FK constraint)
        await this.movementRepo.save(txCtx, movement);
        await this.walletRepo.save(txCtx, wallet);
        await this.walletRepo.adjustSystemWalletBalance(
          txCtx,
          systemWallet.id,
          cmd.amountMinor,
          now,
        );
        await this.transactionRepo.save(txCtx, tx);
        await this.ledgerEntryRepo.saveMany(txCtx, [debitEntry, creditEntry]);
      });
    });

    this.logger.info(ctx, `${methodLogTag} charge success`, {
      wallet_id: cmd.walletId,
      currency_code: walletCurrency,
      transaction_id: txId,
      amount_minor: Number(cmd.amountMinor),
    });

    return { transactionId: txId, movementId };
  }
}
