import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";

export interface PlatformDTO {
  id: string;
  name: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface PaginatedPlatforms {
  platforms: PlatformDTO[];
  next_cursor: string | null;
}

export class ListPlatformsQuery extends IQuery<PaginatedPlatforms> {
  static readonly TYPE = "ListPlatforms";
  constructor(public readonly listing: ListingQuery) {
    super(ListPlatformsQuery.TYPE);
  }
}
