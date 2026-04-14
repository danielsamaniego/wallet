import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IHoldReadStore } from "../../../../application/ports/hold.readstore.js";
import type { HoldDTO } from "../../../../application/query/getHold/query.js";
import type { PaginatedHolds } from "../../../../application/query/listHolds/query.js";

export class PrismaHoldReadStore implements IHoldReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getById(ctx: AppContext, holdId: string, platformId: string): Promise<HoldDTO | null> {
    this.logger.debug(ctx, "HoldReadStore | getById", { hold_id: holdId });

    const row = await this.prisma.hold.findFirst({
      where: { id: holdId },
      include: { wallet: { select: { platformId: true } } },
    });

    if (!row || row.wallet.platformId !== platformId) {
      this.logger.info(ctx, "HoldReadStore | getById hold not found", {
        hold_id: holdId,
        platform_id: platformId,
      });
      return null;
    }

    return this.toDTO(row);
  }

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedHolds | null> {
    this.logger.debug(ctx, "HoldReadStore | getByWallet", { wallet_id: walletId });

    // Verify wallet belongs to platform
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "HoldReadStore | getByWallet wallet not found", {
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

    const rows = await this.prisma.hold.findMany({ where, orderBy, take });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const lastRow = items.at(-1);
      if (lastRow) {
        nextCursor = encodeCursor(listing.sort, lastRow as unknown as Record<string, unknown>);
      }
    }

    this.logger.debug(ctx, "HoldReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      holds: items.map((r) => this.toDTO(r)),
      next_cursor: nextCursor,
    };
  }

  private toDTO(row: {
    id: string;
    walletId: string;
    amountCents: bigint;
    status: string;
    reference: string | null;
    expiresAt: bigint | null;
    createdAt: bigint;
    updatedAt: bigint;
  }): HoldDTO {
    return {
      id: row.id,
      wallet_id: row.walletId,
      amount_cents: toSafeNumber(row.amountCents),
      status: row.status,
      reference: row.reference,
      expires_at: row.expiresAt !== null ? toNumber(row.expiresAt) : null,
      created_at: toNumber(row.createdAt),
      updated_at: toNumber(row.updatedAt),
    };
  }
}
