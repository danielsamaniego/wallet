import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { TransferCommand, TransferResult } from "../../command/transfer/command.js";

export type ITransferUseCase = ICommandHandler<TransferCommand, TransferResult>;
