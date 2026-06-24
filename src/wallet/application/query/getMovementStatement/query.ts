import { IQuery } from "../../../../utils/application/cqrs.js";
import type { StatementEntryDTO } from "../getStatement/query.js";

/**
 * A statement entry enriched with its `wallet_id` + `owner_id`. The per-wallet
 * statement implies the wallet from the path; this platform-scoped lookup does
 * not, so each face carries whose wallet it is.
 */
export interface GlobalStatementEntryDTO extends StatementEntryDTO {
  wallet_id: string;
  owner_id: string;
}

/**
 * All of the platform's user-facing faces of a single movement. By double-entry
 * a movement always has two ledger entries; the system/omnibus counterpart is
 * never exposed, so a normal movement yields ONE face and a transfer yields TWO
 * (sender debit + receiver credit).
 */
export class GetMovementStatementQuery extends IQuery<GlobalStatementEntryDTO[]> {
  static readonly TYPE = "GetMovementStatement";
  constructor(
    public readonly movementId: string,
    public readonly platformId: string,
  ) {
    super(GetMovementStatementQuery.TYPE);
  }
}
