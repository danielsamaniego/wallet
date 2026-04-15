import { ICommand } from "../../../../utils/application/cqrs.js";

export interface PlaceHoldResult {
  holdId: string;
}

export class PlaceHoldCommand extends ICommand<PlaceHoldResult> {
  static readonly TYPE = "PlaceHold";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountMinor: bigint,
    public readonly reference?: string,
    public readonly expiresAt?: number,
  ) {
    super(PlaceHoldCommand.TYPE);
  }
}
