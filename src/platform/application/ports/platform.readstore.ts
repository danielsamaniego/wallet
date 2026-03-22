import type { AppContext } from "../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../utils/kernel/listing.js";
import type { PaginatedPlatforms } from "../query/listPlatforms/query.js";

export interface IPlatformReadStore {
  list(ctx: AppContext, listing: ListingQuery): Promise<PaginatedPlatforms>;
}
