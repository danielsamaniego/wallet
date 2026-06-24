import { IQuery } from "../../../../utils/application/cqrs.js";
import type {
  MovementBreakdownBucketDTO,
  MovementDirection,
  MovementGroupBy,
} from "../../ports/walletAnalytics.readstore.js";

/**
 * Per-wallet movement breakdown: same aggregation as the platform-wide query but
 * scoped to a single wallet. `owner` grouping is rejected at the HTTP layer (it
 * is meaningless for one wallet).
 */
export class GetWalletMovementBreakdownQuery extends IQuery<MovementBreakdownBucketDTO[]> {
  static readonly TYPE = "GetWalletMovementBreakdown";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly fromMs: number,
    public readonly toMs: number,
    public readonly groupBy: MovementGroupBy,
    public readonly direction: MovementDirection,
    public readonly metadataKey?: string,
    public readonly metadataFilterKey?: string,
    public readonly metadataFilterValue?: string,
  ) {
    super(GetWalletMovementBreakdownQuery.TYPE);
  }
}
