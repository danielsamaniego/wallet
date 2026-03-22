import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";

export interface TransactionDTO {
  id: string;
  wallet_id: string;
  counterpart_wallet_id: string | null;
  type: string;
  amount_cents: number | string;
  status: string;
  idempotency_key: string | null;
  reference: string | null;
  metadata: Record<string, unknown> | null;
  hold_id: string | null;
  created_at: number;
}

export interface PaginatedTransactions {
  transactions: TransactionDTO[];
  next_cursor: string | null;
}

export class GetTransactionsQuery extends IQuery<PaginatedTransactions> {
  static readonly TYPE = "GetTransactions";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super(GetTransactionsQuery.TYPE);
  }
}
