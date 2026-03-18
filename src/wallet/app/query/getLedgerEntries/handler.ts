import { AppError } from "../../../../shared/appError.js";
import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";

export interface GetLedgerEntriesQuery {
  walletId: string;
  platformId: string;
  limit: number;
  cursor?: string;
}

export interface LedgerEntryDTO {
  id: string;
  transaction_id: string;
  wallet_id: string;
  entry_type: string;
  amount_cents: number | string;
  balance_after_cents: number | string;
  created_at: number;
}

export interface PaginatedLedgerEntries {
  ledger_entries: LedgerEntryDTO[];
  next_cursor: string | null;
}

export interface LedgerEntryReadStore {
  getByWallet(
    walletId: string,
    platformId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedLedgerEntries | null>;
}

const mainLogTag = "GetLedgerEntriesHandler";

export class GetLedgerEntriesHandler {
  constructor(
    private readonly readStore: LedgerEntryReadStore,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, query: GetLedgerEntriesQuery): Promise<PaginatedLedgerEntries> {
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
