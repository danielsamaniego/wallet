import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";
import type { HoldDTO } from "../getHold/query.js";

export interface PaginatedHolds {
  holds: HoldDTO[];
  next_cursor: string | null;
}

export class ListHoldsQuery extends IQuery<PaginatedHolds> {
  static readonly TYPE = "ListHolds";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super(ListHoldsQuery.TYPE);
  }
}
