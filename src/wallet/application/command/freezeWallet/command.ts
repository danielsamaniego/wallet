import { ICommand } from "../../../../utils/application/cqrs.js";

export class FreezeWalletCommand extends ICommand<void> {
  static readonly TYPE = "FreezeWallet";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) { super(FreezeWalletCommand.TYPE); }
}
