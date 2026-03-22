import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { VoidHoldCommand } from "../../command/voidHold/command.js";

export type IVoidHoldUseCase = ICommandHandler<VoidHoldCommand, void>;
