import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { CloseWalletCommand } from "../../command/closeWallet/command.js";

export type ICloseWalletUseCase = ICommandHandler<CloseWalletCommand, void>;
