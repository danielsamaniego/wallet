import { ICommand } from "../../../../../utils/application/cqrs.js";

export interface CleanupIdempotencyResult {
  deletedCount: number;
}

export class CleanupIdempotencyCommand extends ICommand<CleanupIdempotencyResult> {
  static readonly TYPE = "CleanupIdempotency";
  constructor() {
    super(CleanupIdempotencyCommand.TYPE);
  }
}
