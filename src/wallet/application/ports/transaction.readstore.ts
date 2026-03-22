import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { PaginatedTransactions } from "../query/getTransactions/query.js";

export interface ITransactionReadStore {
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedTransactions | null>;
}
