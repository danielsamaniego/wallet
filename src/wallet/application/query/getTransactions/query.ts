import type { ListingQuery } from "../../../../shared/domain/kernel/listing.js";

export interface GetTransactionsQuery {
  walletId: string;
  platformId: string;
  listing: ListingQuery;
}

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

import type { AppContext } from "../../../../shared/domain/kernel/context.js";

export interface ITransactionReadStore {
  getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedTransactions | null>;
}
