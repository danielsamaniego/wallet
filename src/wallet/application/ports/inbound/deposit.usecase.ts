import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { DepositCommand, DepositResult } from "../../command/deposit/command.js";

export type IDepositUseCase = ICommandHandler<DepositCommand, DepositResult>;
