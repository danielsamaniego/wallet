import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletReadStore } from "../../ports/wallet.readstore.js";
import type { ListWalletsQuery, PaginatedWallets } from "./query.js";

const mainLogTag = "ListWalletsUseCase";

export class ListWalletsUseCase implements IQueryHandler<ListWalletsQuery, PaginatedWallets> {
  constructor(
    private readonly readStore: IWalletReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: ListWalletsQuery): Promise<PaginatedWallets> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: query.platformId,
      limit: query.listing.limit,
      cursor: query.listing.cursor ?? null,
      filters_count: query.listing.filters.length,
      sort: query.listing.sort.map((s) => `${s.field}:${s.direction}`),
    });

    const result = await this.readStore.list(ctx, query.platformId, query.listing);

    this.logger.info(ctx, `${methodLogTag} success`, {
      platform_id: query.platformId,
      wallets_count: result.wallets.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
