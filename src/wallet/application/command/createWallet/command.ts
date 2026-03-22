import { ICommand } from "../../../../shared/application/cqrs.js";

export interface CreateWalletResult {
  walletId: string;
}

export class CreateWalletCommand extends ICommand<CreateWalletResult> {
  static readonly TYPE = "CreateWallet";
  constructor(
    public readonly ownerId: string,
    public readonly platformId: string,
    public readonly currencyCode: string,
  ) { super(CreateWalletCommand.TYPE); }
}
