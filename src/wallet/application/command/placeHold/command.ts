import { ICommand } from "../../../../shared/application/cqrs.js";

export interface PlaceHoldResult {
  holdId: string;
}

export class PlaceHoldCommand extends ICommand<PlaceHoldResult> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountCents: bigint,
    public readonly reference?: string,
    public readonly expiresAt?: number,
  ) { super(); }
}
