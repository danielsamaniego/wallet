import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/kernel/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { LedgerEntryDTO, PaginatedLedgerEntries } from "../../../../application/query/getLedgerEntries/query.js";
import type { ILedgerEntryReadStore } from "../../../../application/ports/ledgerEntry.readstore.js";

export class PrismaLedgerEntryReadStore implements ILedgerEntryReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedLedgerEntries | null> {
    this.logger.debug(ctx, "LedgerEntryReadStore | getByWallet", { wallet_id: walletId });
    // Verify wallet belongs to platform
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "LedgerEntryReadStore | getByWallet wallet not found", {
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
    );

    const rows = await this.prisma.ledgerEntry.findMany({ where, orderBy, take });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastRow = items[items.length - 1]!;
      nextCursor = encodeCursor(
        listing.sort,
        lastRow as unknown as Record<string, unknown>,
      );
    }

    this.logger.debug(ctx, "LedgerEntryReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      ledger_entries: items.map((r) => this.toDTO(r)),
      next_cursor: nextCursor,
    };
  }

  private toDTO(row: {
    id: string;
    transactionId: string;
    walletId: string;
    entryType: string;
    amountCents: bigint;
    balanceAfterCents: bigint;
    createdAt: bigint;
  }): LedgerEntryDTO {
    return {
      id: row.id,
      transaction_id: row.transactionId,
      wallet_id: row.walletId,
      entry_type: row.entryType,
      amount_cents: toSafeNumber(row.amountCents),
      balance_after_cents: toSafeNumber(row.balanceAfterCents),
      created_at: toNumber(row.createdAt),
    };
  }
}
