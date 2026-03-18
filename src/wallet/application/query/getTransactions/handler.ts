import { AppError } from "../../../../shared/domain/appError.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type {
  GetTransactionsQuery,
  ITransactionReadStore,
  PaginatedTransactions,
} from "./query.js";

const mainLogTag = "GetTransactionsHandler";

export class GetTransactionsHandler {
  constructor(
    private readonly readStore: ITransactionReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetTransactionsQuery): Promise<PaginatedTransactions> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });

    const result = await this.readStore.getByWallet(
      ctx,
      query.walletId,
      query.platformId,
      query.limit,
      query.cursor,
    );

    if (!result) {
      this.logger.info(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    return result;
  }
}
