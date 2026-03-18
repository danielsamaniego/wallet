import { AppError } from "../../../../shared/appError.js";
import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";

export interface GetTransactionsQuery {
  walletId: string;
  platformId: string;
  limit: number;
  cursor?: string;
}

export interface TransactionDTO {
  id: string;
  wallet_id: string;
  counterpart_wallet_id: string | null;
  type: string;
  amount_cents: number | string;
  status: string;
  idempotency_key: string | null;
  reference: string | null;
  metadata: Record<string, unknown> | null;
  hold_id: string | null;
  created_at: number;
}

export interface PaginatedTransactions {
  transactions: TransactionDTO[];
  next_cursor: string | null;
}

export interface TransactionReadStore {
  getByWallet(
    walletId: string,
    platformId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedTransactions | null>;
}

const mainLogTag = "GetTransactionsHandler";

export class GetTransactionsHandler {
  constructor(
    private readonly readStore: TransactionReadStore,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, query: GetTransactionsQuery): Promise<PaginatedTransactions> {
    const methodLogTag = `${mainLogTag} | handle`;

    const result = await this.readStore.getByWallet(
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
