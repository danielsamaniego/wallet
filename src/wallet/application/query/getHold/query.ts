import { IQuery } from "../../../../utils/application/cqrs.js";

export interface HoldDTO {
  id: string;
  wallet_id: string;
  amount_minor: number | string;
  status: string;
  reference: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export class GetHoldQuery extends IQuery<HoldDTO> {
  static readonly TYPE = "GetHold";
  constructor(
    public readonly holdId: string,
    public readonly platformId: string,
  ) {
    super(GetHoldQuery.TYPE);
  }
}
