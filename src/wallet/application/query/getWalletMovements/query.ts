import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";

/**
 * A wallet "statement line": one row per (wallet, movement), assembled from the
 * wallet's own ledger entry (running balance + signed amount), its transaction
 * (type, reference, metadata, counterpart) and its movement (reason).
 */
export interface WalletMovementDTO {
  movement_id: string;
  transaction_id: string;
  type: string;
  amount_minor: number | string;
  direction: "credit" | "debit";
  reason: string | null;
  reference: string | null;
  metadata: Record<string, unknown> | null;
  counterpart_wallet_id: string | null;
  hold_id: string | null;
  status: string;
  balance_before_minor: number | string;
  balance_after_minor: number | string;
  created_at: number;
}

export interface PaginatedWalletMovements {
  movements: WalletMovementDTO[];
  next_cursor: string | null;
}

export class GetWalletMovementsQuery extends IQuery<PaginatedWalletMovements> {
  static readonly TYPE = "GetWalletMovements";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
  ) {
    super(GetWalletMovementsQuery.TYPE);
  }
}
