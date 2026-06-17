import { IQuery } from "../../../../utils/application/cqrs.js";
import type { StatementEntryDTO } from "../getStatement/query.js";

export class GetStatementEntryQuery extends IQuery<StatementEntryDTO> {
  static readonly TYPE = "GetStatementEntry";
  constructor(
    public readonly walletId: string,
    public readonly movementId: string,
    public readonly platformId: string,
  ) {
    super(GetStatementEntryQuery.TYPE);
  }
}
