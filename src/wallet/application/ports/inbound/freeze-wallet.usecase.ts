import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { FreezeWalletCommand } from "../../command/freezeWallet/command.js";

export type IFreezeWalletUseCase = ICommandHandler<FreezeWalletCommand, void>;
