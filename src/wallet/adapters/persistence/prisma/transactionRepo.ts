import type { PrismaClient } from "@prisma/client";
import type { TransactionRepository } from "../../../domain/ports/transactionRepository.js";
import type { Transaction } from "../../../domain/transaction/entity.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaTransactionRepo implements TransactionRepository {
  constructor(private readonly prisma: PrismaTransactionClient) {}

  async save(transaction: Transaction): Promise<void> {
    await this.prisma.transaction.create({
      data: this.toRow(transaction),
    });
  }

  async saveMany(transactions: Transaction[]): Promise<void> {
    if (transactions.length === 0) return;
    await this.prisma.transaction.createMany({
      data: transactions.map((t) => this.toRow(t)),
    });
  }

  private toRow(t: Transaction) {
    return {
      id: t.id,
      walletId: t.walletId,
      counterpartWalletId: t.counterpartWalletId,
      type: t.type,
      amountCents: t.amountCents,
      status: t.status,
      idempotencyKey: t.idempotencyKey,
      reference: t.reference,
      metadata: (t.metadata ?? undefined) as Record<string, string> | undefined,
      holdId: t.holdId,
      createdAt: BigInt(t.createdAt),
    };
  }
}
