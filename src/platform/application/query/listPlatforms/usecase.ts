import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IPlatformReadStore } from "../../ports/platform.readstore.js";
import type { ListPlatformsQuery, PaginatedPlatforms } from "./query.js";

const mainLogTag = "ListPlatformsUseCase";

export class ListPlatformsUseCase implements IQueryHandler<ListPlatformsQuery, PaginatedPlatforms> {
  constructor(
    private readonly readStore: IPlatformReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: ListPlatformsQuery): Promise<PaginatedPlatforms> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      limit: query.listing.limit,
      cursor: query.listing.cursor ?? null,
      filters_count: query.listing.filters.length,
      sort: query.listing.sort.map((s) => `${s.field}:${s.direction}`),
    });

    const result = await this.readStore.list(ctx, query.listing);

    this.logger.info(ctx, `${methodLogTag} success`, {
      platforms_count: result.platforms.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
