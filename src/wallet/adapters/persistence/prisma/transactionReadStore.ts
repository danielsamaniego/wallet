import type { PrismaClient } from "@prisma/client";
import { toNumber, toSafeNumber } from "../../../../shared/kernel/bigint.js";
import type {
  PaginatedTransactions,
  TransactionDTO,
  TransactionReadStore,
} from "../../../app/query/getTransactions/handler.js";

export class PrismaTransactionReadStore implements TransactionReadStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getByWallet(
    walletId: string,
    platformId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedTransactions | null> {
    // Verify wallet belongs to platform
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) return null;

    const rows = await this.prisma.transaction.findMany({
      where: { walletId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      transactions: items.map((r) => this.toDTO(r)),
      next_cursor: hasMore && items.length > 0 ? items[items.length - 1]!.id : null,
    };
  }

  private toDTO(row: {
    id: string;
    walletId: string;
    counterpartWalletId: string | null;
    type: string;
    amountCents: bigint;
    status: string;
    idempotencyKey: string | null;
    reference: string | null;
    metadata: unknown;
    holdId: string | null;
    createdAt: bigint;
  }): TransactionDTO {
    return {
      id: row.id,
      wallet_id: row.walletId,
      counterpart_wallet_id: row.counterpartWalletId,
      type: row.type,
      amount_cents: toSafeNumber(row.amountCents),
      status: row.status,
      idempotency_key: row.idempotencyKey,
      reference: row.reference,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
      hold_id: row.holdId,
      created_at: toNumber(row.createdAt),
    };
  }
}
