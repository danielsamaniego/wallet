import type { PrismaClient } from "@prisma/client";
import type { LedgerEntry } from "../../../domain/ledgerEntry/entity.js";
import type { LedgerEntryRepository } from "../../../domain/ports/ledgerEntryRepository.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaLedgerEntryRepo implements LedgerEntryRepository {
  constructor(private readonly prisma: PrismaTransactionClient) {}

  async saveMany(entries: LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.ledgerEntry.createMany({
      data: entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        walletId: e.walletId,
        entryType: e.entryType,
        amountCents: e.amountCents,
        balanceAfterCents: e.balanceAfterCents,
        createdAt: BigInt(e.createdAt),
      })),
    });
  }
}
