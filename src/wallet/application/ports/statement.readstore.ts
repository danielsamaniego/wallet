import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { PaginatedStatement, StatementEntryDTO } from "../query/getStatement/query.js";

export interface IStatementReadStore {
  /**
   * Returns the wallet's movement statement (cursor-paginated) or null if the
   * wallet does not exist for the given platform.
   */
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
    q?: string,
  ): Promise<PaginatedStatement | null>;

  /**
   * Returns a single statement line for (wallet, movement) or null if the
   * wallet/movement does not exist for the given platform.
   */
  getOne(
    ctx: AppContext,
    walletId: string,
    movementId: string,
    platformId: string,
  ): Promise<StatementEntryDTO | null>;
}
