import { ICommand } from "../../../../utils/application/cqrs.js";

export class VoidHoldCommand extends ICommand<void> {
  static readonly TYPE = "VoidHold";
  constructor(
    public readonly holdId: string,
    public readonly platformId: string,
  ) { super(VoidHoldCommand.TYPE); }
}
