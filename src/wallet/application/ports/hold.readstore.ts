import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { HoldDTO } from "../query/getHold/query.js";
import type { PaginatedHolds } from "../query/listHolds/query.js";

export interface IHoldReadStore {
  getById(ctx: AppContext, holdId: string, platformId: string): Promise<HoldDTO | null>;
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedHolds | null>;
}
