import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { Movement } from "../../../../domain/movement/movement.entity.js";
import type { IMovementRepository } from "../../../../domain/ports/movement.repository.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaMovementRepo implements IMovementRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async save(ctx: AppContext, movement: Movement): Promise<void> {
    this.logger.debug(ctx, "MovementRepo | save", { movement_id: movement.id });
    await this.client(ctx).movement.create({
      data: {
        id: movement.id,
        type: movement.type,
        createdAt: BigInt(movement.createdAt),
      },
    });
  }
}
