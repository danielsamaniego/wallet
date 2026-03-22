import type { ICommandHandler } from "../../../../shared/application/cqrs.js";
import type { PlaceHoldCommand, PlaceHoldResult } from "../../command/placeHold/command.js";

export type IPlaceHoldUseCase = ICommandHandler<PlaceHoldCommand, PlaceHoldResult>;
