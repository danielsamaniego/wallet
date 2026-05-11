import { IQuery } from "../../../../utils/application/cqrs.js";

/**
 * Movement read DTO. Surfaces the lifecycle state of a movement so that
 * async-processing callers can poll until a 202-accepted movement reaches
 * `posted` (or `failed`). For synchronous flows every movement is already
 * `posted` at creation; the DTO is still useful for audit and tracing.
 */
export interface MovementDTO {
  id: string;
  type: string;
  status: string;
  reason: string | null;
  failed_reason: string | null;
  created_at: number;
}

export class GetMovementQuery extends IQuery<MovementDTO> {
  static readonly TYPE = "GetMovement";
  constructor(
    public readonly movementId: string,
    public readonly platformId: string,
  ) {
    super(GetMovementQuery.TYPE);
  }
}
