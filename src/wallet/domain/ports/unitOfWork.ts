import type { HoldRepository } from "./holdRepository.js";
import type { LedgerEntryRepository } from "./ledgerEntryRepository.js";
import type { TransactionRepository } from "./transactionRepository.js";
import type { WalletRepository } from "./walletRepository.js";

/**
 * UnitOfWork provides transactional access to all repositories.
 * Command handlers call `run()` to execute multiple writes atomically.
 * The adapter implementation wraps everything in a Prisma $transaction.
 */
export interface UnitOfWork {
  run<T>(
    fn: (repos: {
      wallets: WalletRepository;
      transactions: TransactionRepository;
      ledgerEntries: LedgerEntryRepository;
      holds: HoldRepository;
    }) => Promise<T>,
  ): Promise<T>;
}
