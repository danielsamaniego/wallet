import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { WalletDTO } from "../query/getWallet/query.js";
import type { PaginatedWallets } from "../query/listWallets/query.js";

export interface IWalletReadStore {
  getById(ctx: AppContext, walletId: string, platformId: string): Promise<WalletDTO | null>;
  list(ctx: AppContext, platformId: string, listing: ListingQuery): Promise<PaginatedWallets>;
}
