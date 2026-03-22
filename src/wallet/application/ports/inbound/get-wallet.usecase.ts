import type { IQueryHandler } from "../../../../shared/application/cqrs.js";
import type { GetWalletQuery, WalletDTO } from "../../query/getWallet/query.js";

export type IGetWalletUseCase = IQueryHandler<GetWalletQuery, WalletDTO>;
