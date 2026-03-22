import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { CreateWalletCommand, CreateWalletResult } from "../../command/createWallet/command.js";

export type ICreateWalletUseCase = ICommandHandler<CreateWalletCommand, CreateWalletResult>;
