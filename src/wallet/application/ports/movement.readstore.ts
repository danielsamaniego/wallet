import type { AppContext } from "../../../utils/kernel/context.js";
import type { MovementDTO } from "../query/getMovement/query.js";

export interface IMovementReadStore {
  /**
   * Returns the movement only when it belongs to a wallet of the given
   * platform (cross-tenant isolation). Returns `null` when the movement
   * does not exist or is owned by a different platform — the caller maps
   * both cases to a single 404 so attackers cannot enumerate ids.
   *
   * Platform ownership is derived from any transaction attached to the
   * movement (transactions reference a wallet, which references a
   * platform). Movements with no transactions yet (i.e. `pending` /
   * `processing` from the async pipeline before Phase 2) are not
   * resolvable through this port yet; they will be supported when the
   * pipeline lands and `Movement.platform_id` is denormalised.
   */
  getById(ctx: AppContext, movementId: string, platformId: string): Promise<MovementDTO | null>;
}
