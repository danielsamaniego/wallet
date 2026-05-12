import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import {
  Movement,
  type MovementQueuePayload,
  type MovementStatus,
  type MovementType,
} from "../../../../domain/movement/movement.entity.js";
import { ErrMovementNotFound } from "../../../../domain/movement/movement.errors.js";
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
    this.logger.debug(ctx, "MovementRepo | save", {
      movement_id: movement.id,
      status: movement.status,
      platform_id: movement.platformId,
    });
    await this.client(ctx).movement.create({
      data: {
        id: movement.id,
        type: movement.type,
        status: movement.status,
        platformId: movement.platformId,
        reason: movement.reason,
        failedReason: movement.failedReason,
        queuePayload: (movement.queuePayload ?? undefined) as never,
        createdAt: BigInt(movement.createdAt),
      },
    });
  }

  async findById(
    ctx: AppContext,
    movementId: string,
    platformId: string,
  ): Promise<Movement | null> {
    this.logger.debug(ctx, "MovementRepo | findById", {
      movement_id: movementId,
      platform_id: platformId,
    });
    // platform_id is required for movements created from Phase 2B onward.
    // Legacy orphans (NULL platform_id) are intentionally not resolvable
    // here — the async worker must never operate on them.
    const row = await this.client(ctx).movement.findFirst({
      where: { id: movementId, platformId },
    });
    if (!row) return null;
    return Movement.reconstruct({
      id: row.id,
      type: row.type as MovementType,
      status: row.status as MovementStatus,
      platformId: row.platformId,
      reason: row.reason,
      failedReason: row.failedReason,
      queuePayload: (row.queuePayload as MovementQueuePayload | null) ?? null,
      createdAt: Number(row.createdAt),
    });
  }

  async markProcessing(ctx: AppContext, movementId: string): Promise<Movement | null> {
    this.logger.debug(ctx, "MovementRepo | markProcessing", { movement_id: movementId });
    // Atomic claim guarded by status='pending'. If another worker already
    // moved it forward, count is 0 and we return null so the caller
    // acks the queue without doing the work twice.
    const result = await this.client(ctx).movement.updateMany({
      where: { id: movementId, status: "pending" },
      data: { status: "processing" },
    });
    if (result.count === 0) {
      this.logger.info(ctx, "MovementRepo | markProcessing not pending", {
        movement_id: movementId,
      });
      return null;
    }
    // Re-load so the caller gets the full aggregate (including `type` and
    // `platform_id`) without needing a separate findById round-trip.
    const row = await this.client(ctx).movement.findUnique({ where: { id: movementId } });
    if (!row) throw ErrMovementNotFound(movementId);
    return Movement.reconstruct({
      id: row.id,
      type: row.type as MovementType,
      status: row.status as MovementStatus,
      platformId: row.platformId,
      reason: row.reason,
      failedReason: row.failedReason,
      queuePayload: (row.queuePayload as MovementQueuePayload | null) ?? null,
      createdAt: Number(row.createdAt),
    });
  }

  async markPosted(ctx: AppContext, movementId: string): Promise<void> {
    this.logger.debug(ctx, "MovementRepo | markPosted", { movement_id: movementId });
    const result = await this.client(ctx).movement.updateMany({
      where: { id: movementId, status: "processing" },
      data: { status: "posted" },
    });
    if (result.count === 0) {
      this.logger.warn(ctx, "MovementRepo | markPosted no row in processing", {
        movement_id: movementId,
      });
      throw ErrMovementNotFound(movementId);
    }
  }

  async markFailed(ctx: AppContext, movementId: string, reason: string): Promise<void> {
    this.logger.debug(ctx, "MovementRepo | markFailed", {
      movement_id: movementId,
      reason,
    });
    const result = await this.client(ctx).movement.updateMany({
      where: { id: movementId, status: "processing" },
      data: { status: "failed", failedReason: reason },
    });
    if (result.count === 0) {
      this.logger.warn(ctx, "MovementRepo | markFailed no row in processing", {
        movement_id: movementId,
      });
      throw ErrMovementNotFound(movementId);
    }
  }
}
