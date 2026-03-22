import { AppError } from "../../../../shared/kernel/appError.js";
import type { IQueryHandler } from "../../../../shared/application/cqrs.js";
import type { AppContext } from "../../../../shared/kernel/context.js";
import type { ILogger } from "../../../../shared/kernel/observability/logger.port.js";
import type {
  GetLedgerEntriesQuery,
  ILedgerEntryReadStore,
  PaginatedLedgerEntries,
} from "./query.js";

const mainLogTag = "GetLedgerEntriesUseCase";

export class GetLedgerEntriesUseCase implements IQueryHandler<GetLedgerEntriesQuery, PaginatedLedgerEntries> {
  constructor(
    private readonly readStore: ILedgerEntryReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetLedgerEntriesQuery): Promise<PaginatedLedgerEntries> {
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
      entries_count: result.ledger_entries.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
