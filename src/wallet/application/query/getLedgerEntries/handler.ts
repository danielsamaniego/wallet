import { AppError } from "../../../../shared/domain/appError.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type {
  GetLedgerEntriesQuery,
  ILedgerEntryReadStore,
  PaginatedLedgerEntries,
} from "./query.js";

const mainLogTag = "GetLedgerEntriesHandler";

export class GetLedgerEntriesHandler {
  constructor(
    private readonly readStore: ILedgerEntryReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetLedgerEntriesQuery): Promise<PaginatedLedgerEntries> {
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
