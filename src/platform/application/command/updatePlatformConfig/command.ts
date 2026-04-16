import { ICommand } from "../../../../utils/application/cqrs.js";

export interface UpdatePlatformConfigResult {
  platformId: string;
}

export class UpdatePlatformConfigCommand extends ICommand<UpdatePlatformConfigResult> {
  static readonly TYPE = "UpdatePlatformConfig";
  constructor(
    public readonly platformId: string,
    public readonly allowNegativeBalance: boolean,
  ) {
    super(UpdatePlatformConfigCommand.TYPE);
  }
}
