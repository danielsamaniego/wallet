import { IQuery } from "../../../../shared/application/cqrs.js";
import type { AppContext } from "../../../../shared/kernel/context.js";
import type { ListingQuery } from "../../../../shared/kernel/listing.js";

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

export class GetLedgerEntriesQuery extends IQuery<PaginatedLedgerEntries> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super();
  }
}

export interface ILedgerEntryReadStore {
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedLedgerEntries | null>;
}
