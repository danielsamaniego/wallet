import type { PrismaClient } from "@prisma/client";
import type { HoldRepository } from "../../../domain/ports/holdRepository.js";
import type { LedgerEntryRepository } from "../../../domain/ports/ledgerEntryRepository.js";
import type { TransactionRepository } from "../../../domain/ports/transactionRepository.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import type { WalletRepository } from "../../../domain/ports/walletRepository.js";
import { PrismaHoldRepo } from "./holdRepo.js";
import { PrismaLedgerEntryRepo } from "./ledgerEntryRepo.js";
import { PrismaTransactionRepo } from "./transactionRepo.js";
import { PrismaWalletRepo } from "./walletRepo.js";

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(
    fn: (repos: {
      wallets: WalletRepository;
      transactions: TransactionRepository;
      ledgerEntries: LedgerEntryRepository;
      holds: HoldRepository;
    }) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const repos = {
        wallets: new PrismaWalletRepo(tx as any),
        transactions: new PrismaTransactionRepo(tx as any),
        ledgerEntries: new PrismaLedgerEntryRepo(tx as any),
        holds: new PrismaHoldRepo(tx as any),
      };
      return fn(repos);
    });
  }
}
