import { ICommand } from "../../../../utils/application/cqrs.js";

export class CloseWalletCommand extends ICommand<void> {
  static readonly TYPE = "CloseWallet";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) {
    super(CloseWalletCommand.TYPE);
  }
}
