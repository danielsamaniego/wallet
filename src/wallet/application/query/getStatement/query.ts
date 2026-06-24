import { IQuery } from "../../../../utils/application/cqrs.js";
import type { ListingQuery } from "../../../../utils/kernel/listing.js";

/**
 * A wallet "statement line": one row per (wallet, movement), assembled from the
 * wallet's own ledger entry (running balance + signed amount), its transaction
 * (type, reference, metadata, counterpart) and its movement (reason).
 */
export interface StatementEntryDTO {
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

export interface PaginatedStatement {
  entries: StatementEntryDTO[];
  next_cursor: string | null;
  /** Full count of matching lines across all pages. Present only when requested. */
  total?: number;
}

export class GetStatementQuery extends IQuery<PaginatedStatement> {
  static readonly TYPE = "GetStatement";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly listing: ListingQuery,
    /** Optional free-text query — case-insensitive substring on reference/reason. */
    public readonly q?: string,
    /** Keep only the wallet's credit or debit lines (its own ledger-entry side). */
    public readonly direction?: "credit" | "debit",
    /** When true, the result carries `total` (full match count across pages). */
    public readonly includeTotal?: boolean,
  ) {
    super(GetStatementQuery.TYPE);
  }
}
