import { ICommand } from "../../../../shared/application/cqrs.js";

export class UnfreezeWalletCommand extends ICommand<void> {
  static readonly TYPE = "UnfreezeWallet";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) { super(UnfreezeWalletCommand.TYPE); }
}
