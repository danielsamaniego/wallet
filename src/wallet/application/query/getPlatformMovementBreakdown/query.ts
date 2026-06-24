import { IQuery } from "../../../../utils/application/cqrs.js";
import type {
  MovementBreakdownBucketDTO,
  MovementDirection,
  MovementGroupBy,
} from "../../ports/walletAnalytics.readstore.js";

/**
 * Platform-wide movement breakdown: aggregates the movements of every wallet of
 * the authenticated platform (the only scope is `platformId`, taken from the API
 * key). Optionally narrowed to a single `ownerId`.
 */
export class GetPlatformMovementBreakdownQuery extends IQuery<MovementBreakdownBucketDTO[]> {
  static readonly TYPE = "GetPlatformMovementBreakdown";
  constructor(
    public readonly platformId: string,
    public readonly fromMs: number,
    public readonly toMs: number,
    public readonly groupBy: MovementGroupBy,
    public readonly direction: MovementDirection,
    public readonly metadataKey?: string,
    public readonly ownerId?: string,
  ) {
    super(GetPlatformMovementBreakdownQuery.TYPE);
  }
}
