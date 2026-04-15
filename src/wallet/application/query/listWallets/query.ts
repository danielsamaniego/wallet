import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";
import type { WalletDTO } from "../getWallet/query.js";

export interface PaginatedWallets {
  wallets: WalletDTO[];
  next_cursor: string | null;
}

export class ListWalletsQuery extends IQuery<PaginatedWallets> {
  static readonly TYPE = "ListWallets";
  constructor(
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super(ListWalletsQuery.TYPE);
  }
}
