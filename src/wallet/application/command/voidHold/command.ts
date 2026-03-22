import { ICommand } from "../../../../shared/application/cqrs.js";

export class VoidHoldCommand extends ICommand<void> {
  constructor(
    public readonly holdId: string,
    public readonly platformId: string,
  ) { super(); }
}
