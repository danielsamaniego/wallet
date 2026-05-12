import type { PrismaClient } from "@prisma/client";
import { toNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IMovementReadStore } from "../../../../application/ports/movement.readstore.js";
import type { MovementDTO } from "../../../../application/query/getMovement/query.js";

export class PrismaMovementReadStore implements IMovementReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getById(
    ctx: AppContext,
    movementId: string,
    platformId: string,
  ): Promise<MovementDTO | null> {
    this.logger.debug(ctx, "MovementReadStore | getById", { movement_id: movementId });

    // Platform isolation, two paths combined with OR:
    //   1) NEW: direct `platformId` column match. Required for movements created
    //      by the Phase 2B async pipeline that have no transactions yet
    //      (status `pending` or `processing`).
    //   2) LEGACY: transitive path through `transactions.wallet.platformId`,
    //      kept as fallback for pre-Phase-2B-migration orphan rows whose
    //      `platform_id` could not be backfilled (no transactions to derive
    //      it from). They remain reachable through this path if the caller
    //      legitimately owns one of their transactions' wallets.
    // Both paths collapse a missing-or-foreign-tenant lookup to null → 404 so
    // attackers cannot enumerate movement ids.
    const row = await this.prisma.movement.findFirst({
      where: {
        id: movementId,
        OR: [{ platformId }, { transactions: { some: { wallet: { platformId } } } }],
      },
    });

    if (!row) {
      this.logger.info(ctx, "MovementReadStore | getById movement not found", {
        movement_id: movementId,
        platform_id: platformId,
      });
      return null;
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      reason: row.reason,
      failed_reason: row.failedReason,
      created_at: toNumber(row.createdAt),
    };
  }
}
