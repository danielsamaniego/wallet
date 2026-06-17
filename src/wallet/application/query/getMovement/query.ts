import { IQuery } from "../../../../utils/application/cqrs.js";
import type { WalletMovementDTO } from "../getWalletMovements/query.js";

export class GetMovementQuery extends IQuery<WalletMovementDTO> {
  static readonly TYPE = "GetMovement";
  constructor(
    public readonly walletId: string,
    public readonly movementId: string,
    public readonly platformId: string,
  ) {
    super(GetMovementQuery.TYPE);
  }
}
