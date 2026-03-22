import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { PaginatedLedgerEntries } from "../query/getLedgerEntries/query.js";

export interface ILedgerEntryReadStore {
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedLedgerEntries | null>;
}
