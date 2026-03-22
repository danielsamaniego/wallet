import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../../shared/domain/observability/logger.port.js";
import type { ITransactionRepository } from "../../../../domain/ports/transaction.repository.js";
import type { Transaction } from "../../../../domain/transaction/transaction.entity.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaTransactionRepo implements ITransactionRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async save(ctx: AppContext, transaction: Transaction): Promise<void> {
    this.logger.debug(ctx, "TransactionRepo | save", { transaction_id: transaction.id });
    await this.client(ctx).transaction.create({ data: this.toRow(transaction) });
  }

  async saveMany(ctx: AppContext, transactions: Transaction[]): Promise<void> {
    this.logger.debug(ctx, "TransactionRepo | saveMany", { count: transactions.length });
    if (transactions.length === 0) return;
    await this.client(ctx).transaction.createMany({
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
      movementId: t.movementId,
      createdAt: BigInt(t.createdAt),
    };
  }
}
