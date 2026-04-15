import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";

export interface LedgerEntryDTO {
  id: string;
  transaction_id: string;
  wallet_id: string;
  entry_type: string;
  amount_minor: number | string;
  balance_after_minor: number | string;
  created_at: number;
}

export interface PaginatedLedgerEntries {
  ledger_entries: LedgerEntryDTO[];
  next_cursor: string | null;
}

export class GetLedgerEntriesQuery extends IQuery<PaginatedLedgerEntries> {
  static readonly TYPE = "GetLedgerEntries";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super(GetLedgerEntriesQuery.TYPE);
  }
}
