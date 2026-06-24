import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IStatementReadStore } from "../../ports/statement.readstore.js";
import type { GetStatementQuery, PaginatedStatement } from "./query.js";

const mainLogTag = "GetStatementUseCase";

export class GetStatementUseCase implements IQueryHandler<GetStatementQuery, PaginatedStatement> {
  constructor(
    private readonly readStore: IStatementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetStatementQuery): Promise<PaginatedStatement> {
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
      query.q,
      query.direction,
      query.includeTotal,
    );

    if (!result) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      entries_count: result.entries.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
