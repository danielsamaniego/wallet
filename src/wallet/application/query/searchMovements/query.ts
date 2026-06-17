import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";
import type { PaginatedWalletMovements } from "../getWalletMovements/query.js";

export class SearchMovementsQuery extends IQuery<PaginatedWalletMovements> {
  static readonly TYPE = "SearchMovements";
  constructor(
    public readonly platformId: string,
    public readonly q: string | undefined,
    public readonly listing: ListingQuery,
  ) {
    super(SearchMovementsQuery.TYPE);
  }
}
