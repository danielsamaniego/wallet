import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type {
  PaginatedWalletMovements,
  WalletMovementDTO,
} from "../query/getWalletMovements/query.js";

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
    q?: string,
  ): Promise<PaginatedWalletMovements | null>;

  /**
   * Returns a single statement line for (wallet, movement) or null if the
   * wallet/movement does not exist for the given platform.
   */
  getOne(
    ctx: AppContext,
    walletId: string,
    movementId: string,
    platformId: string,
  ): Promise<WalletMovementDTO | null>;
}
