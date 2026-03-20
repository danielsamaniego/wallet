import type { ListingQuery } from "../../../../shared/domain/kernel/listing.js";

export interface GetLedgerEntriesQuery {
  walletId: string;
  platformId: string;
  listing: ListingQuery;
}

export interface LedgerEntryDTO {
  id: string;
  transaction_id: string;
  wallet_id: string;
  entry_type: string;
  amount_cents: number | string;
  balance_after_cents: number | string;
  created_at: number;
}

export interface PaginatedLedgerEntries {
  ledger_entries: LedgerEntryDTO[];
  next_cursor: string | null;
}

import type { AppContext } from "../../../../shared/domain/kernel/context.js";

export interface ILedgerEntryReadStore {
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedLedgerEntries | null>;
}
