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

    // Platform isolation: a movement is resolvable only when at least one
    // of its transactions points at a wallet owned by the requesting
    // platform. This blocks cross-tenant enumeration without leaking the
    // movement's existence (caller maps null → 404).
    const row = await this.prisma.movement.findFirst({
      where: {
        id: movementId,
        transactions: { some: { wallet: { platformId } } },
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
