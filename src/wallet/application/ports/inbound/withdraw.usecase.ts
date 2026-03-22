import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { WithdrawCommand, WithdrawResult } from "../../command/withdraw/command.js";

export type IWithdrawUseCase = ICommandHandler<WithdrawCommand, WithdrawResult>;
