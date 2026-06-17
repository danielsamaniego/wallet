import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { PaginatedWalletMovements } from "../query/getWalletMovements/query.js";

export interface IWalletMovementReadStore {
  /**
   * Returns the wallet's movement statement (cursor-paginated) or null if the
   * wallet does not exist for the given platform.
   */
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedWalletMovements | null>;
}
