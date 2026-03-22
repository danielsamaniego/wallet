import { AppError } from "../../../../utils/kernel/appError.js";
import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { ListHoldsQuery, PaginatedHolds } from "./query.js";
import type { IHoldReadStore } from "../../ports/hold.readstore.js";

const mainLogTag = "ListHoldsUseCase";

export class ListHoldsUseCase implements IQueryHandler<ListHoldsQuery, PaginatedHolds> {
  constructor(
    private readonly readStore: IHoldReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: ListHoldsQuery): Promise<PaginatedHolds> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      limit: query.listing.limit,
      cursor: query.listing.cursor ?? null,
      filters_count: query.listing.filters.length,
      sort: query.listing.sort.map((s) => `${s.field}:${s.direction}`),
    });

    const result = await this.readStore.getByWallet(
      ctx,
      query.walletId,
      query.platformId,
      query.listing,
    );

    if (!result) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      holds_count: result.holds.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
