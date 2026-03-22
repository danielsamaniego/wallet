import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { UnfreezeWalletCommand } from "../../command/unfreezeWallet/command.js";

export type IUnfreezeWalletUseCase = ICommandHandler<UnfreezeWalletCommand, void>;
