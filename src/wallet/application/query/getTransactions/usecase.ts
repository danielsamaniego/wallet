import { AppError } from "../../../../shared/domain/appError.js";
import type { IQueryHandler } from "../../../../shared/application/cqrs.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type {
  GetTransactionsQuery,
  ITransactionReadStore,
  PaginatedTransactions,
} from "./query.js";

const mainLogTag = "GetTransactionsUseCase";

export class GetTransactionsUseCase implements IQueryHandler<GetTransactionsQuery, PaginatedTransactions> {
  constructor(
    private readonly readStore: ITransactionReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetTransactionsQuery): Promise<PaginatedTransactions> {
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
      transactions_count: result.transactions.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
