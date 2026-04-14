import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IPlatformReadStore } from "../../../../application/ports/platform.readstore.js";
import type {
  PaginatedPlatforms,
  PlatformDTO,
} from "../../../../application/query/listPlatforms/query.js";

export class PrismaPlatformReadStore implements IPlatformReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async list(ctx: AppContext, listing: ListingQuery): Promise<PaginatedPlatforms> {
    this.logger.debug(ctx, "PlatformReadStore | list");

    const { where, orderBy, take } = buildPrismaListing(
      {},
      listing.filters,
      listing.sort,
      listing.limit,
      listing.cursor,
    );

    const rows = await this.prisma.platform.findMany({
      where,
      orderBy,
      take,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const lastRow = items.at(-1);
      if (lastRow) {
        nextCursor = encodeCursor(listing.sort, lastRow as unknown as Record<string, unknown>);
      }
    }

    this.logger.debug(ctx, "PlatformReadStore | list result", {
      count: items.length,
      has_more: hasMore,
    });

    return {
      platforms: items.map((r) => this.toDTO(r)),
      next_cursor: nextCursor,
    };
  }

  private toDTO(row: {
    id: string;
    name: string;
    status: string;
    createdAt: bigint;
    updatedAt: bigint;
  }): PlatformDTO {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      created_at: toNumber(row.createdAt),
      updated_at: toNumber(row.updatedAt),
    };
  }
}
