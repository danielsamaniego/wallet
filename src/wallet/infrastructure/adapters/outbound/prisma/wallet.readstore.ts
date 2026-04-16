import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IWalletReadStore } from "../../../../application/ports/wallet.readstore.js";
import type { WalletDTO } from "../../../../application/query/getWallet/query.js";
import type { PaginatedWallets } from "../../../../application/query/listWallets/query.js";

export class PrismaWalletReadStore implements IWalletReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getById(ctx: AppContext, walletId: string, platformId: string): Promise<WalletDTO | null> {
    this.logger.debug(ctx, "WalletReadStore | getById", { wallet_id: walletId });
    const row = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
    });

    if (!row) {
      this.logger.info(ctx, "WalletReadStore | getById wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    return this.toDTO(row);
  }

  async list(
    ctx: AppContext,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedWallets> {
    this.logger.debug(ctx, "WalletReadStore | list", { platform_id: platformId });

    const { where, orderBy, take } = buildPrismaListing(
      { platformId },
      listing.filters,
      listing.sort,
      listing.limit,
      listing.cursor,
    );

    const rows = await this.prisma.wallet.findMany({ where, orderBy, take });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      // hasMore implies items.length === listing.limit > 0, so the last element exists.
      const lastRow = items[items.length - 1] as Record<string, unknown>;
      nextCursor = encodeCursor(listing.sort, lastRow);
    }

    this.logger.debug(ctx, "WalletReadStore | list result", {
      platform_id: platformId,
      count: items.length,
      has_more: hasMore,
    });

    const wallets = await Promise.all(items.map((r) => this.toDTO(r)));
    return { wallets, next_cursor: nextCursor };
  }

  private async toDTO(row: {
    id: string;
    ownerId: string;
    platformId: string;
    currencyCode: string;
    cachedBalanceMinor: bigint;
    status: string;
    isSystem: boolean;
    createdAt: bigint;
    updatedAt: bigint;
  }): Promise<WalletDTO> {
    const now = BigInt(Date.now());
    const holdSum = await this.prisma.hold.aggregate({
      where: {
        walletId: row.id,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { amountMinor: true },
    });

    const activeHolds = holdSum._sum.amountMinor ?? 0n;
    const availableBalance = row.cachedBalanceMinor - activeHolds;

    return {
      id: row.id,
      owner_id: row.ownerId,
      platform_id: row.platformId,
      currency_code: row.currencyCode,
      balance_minor: toSafeNumber(row.cachedBalanceMinor),
      available_balance_minor: toSafeNumber(availableBalance),
      status: row.status,
      is_system: row.isSystem,
      created_at: toNumber(row.createdAt),
      updated_at: toNumber(row.updatedAt),
    };
  }
}
