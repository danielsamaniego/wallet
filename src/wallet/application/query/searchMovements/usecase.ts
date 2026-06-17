import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletMovementReadStore } from "../../ports/walletMovement.readstore.js";
import type { PaginatedWalletMovements } from "../getWalletMovements/query.js";
import type { SearchMovementsQuery } from "./query.js";

const mainLogTag = "SearchMovementsUseCase";

export class SearchMovementsUseCase
  implements IQueryHandler<SearchMovementsQuery, PaginatedWalletMovements>
{
  constructor(
    private readonly readStore: IWalletMovementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: SearchMovementsQuery): Promise<PaginatedWalletMovements> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: query.platformId,
      has_query: query.q !== undefined,
      limit: query.listing.limit,
    });

    const result = await this.readStore.search(ctx, query.platformId, query.q, query.listing);

    this.logger.info(ctx, `${methodLogTag} success`, {
      platform_id: query.platformId,
      count: result.movements.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
