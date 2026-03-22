import type { AppContext } from "../../../utils/kernel/context.js";
import type { WalletDTO } from "../query/getWallet/query.js";

export interface IWalletReadStore {
  getById(ctx: AppContext, walletId: string, platformId: string): Promise<WalletDTO | null>;
}
