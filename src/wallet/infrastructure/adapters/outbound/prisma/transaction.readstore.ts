import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { ITransactionReadStore } from "../../../../application/ports/transaction.readstore.js";
import type {
  PaginatedTransactions,
  TransactionDTO,
} from "../../../../application/query/getTransactions/query.js";

export class PrismaTransactionReadStore implements ITransactionReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedTransactions | null> {
    this.logger.debug(ctx, "TransactionReadStore | getByWallet", { wallet_id: walletId });
    // Verify wallet belongs to platform
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "TransactionReadStore | getByWallet wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const { where, orderBy, take } = buildPrismaListing(
      { walletId },
      listing.filters,
      listing.sort,
      listing.limit,
      listing.cursor,
      listing.jsonFilters,
    );

    const rows = await this.prisma.transaction.findMany({ where, orderBy, take });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const lastRow = items.at(-1);
      if (lastRow) {
        nextCursor = encodeCursor(listing.sort, lastRow as unknown as Record<string, unknown>);
      }
    }

    this.logger.debug(ctx, "TransactionReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      transactions: items.map((r) => this.toDTO(r)),
      next_cursor: nextCursor,
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
