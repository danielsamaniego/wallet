import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { CaptureHoldCommand, CaptureHoldResult } from "../../command/captureHold/command.js";

export type ICaptureHoldUseCase = ICommandHandler<CaptureHoldCommand, CaptureHoldResult>;
