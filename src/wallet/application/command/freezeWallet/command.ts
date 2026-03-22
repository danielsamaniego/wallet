import { ICommand } from "../../../../shared/application/cqrs.js";

export class FreezeWalletCommand extends ICommand<void> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) { super(); }
}
