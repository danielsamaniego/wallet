import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IPlatformRepository } from "../../../../domain/ports/platform.repository.js";
import { Platform, type PlatformStatus } from "../../../../domain/platform/platform.aggregate.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaPlatformRepo implements IPlatformRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async save(ctx: AppContext, platform: Platform): Promise<void> {
    this.logger.debug(ctx, "PlatformRepo | save", { platform_id: platform.id });
    const db = this.client(ctx);

    await db.platform.upsert({
      where: { id: platform.id },
      create: {
        id: platform.id,
        name: platform.name,
        apiKeyHash: platform.apiKeyHash,
        apiKeyId: platform.apiKeyId,
        status: platform.status,
        createdAt: BigInt(platform.createdAt),
        updatedAt: BigInt(platform.updatedAt),
      },
      update: {
        name: platform.name,
        status: platform.status,
        updatedAt: BigInt(platform.updatedAt),
      },
    });
  }

  async findById(ctx: AppContext, platformId: string): Promise<Platform | null> {
    this.logger.debug(ctx, "PlatformRepo | findById", { platform_id: platformId });
    const row = await this.client(ctx).platform.findUnique({ where: { id: platformId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByApiKeyId(ctx: AppContext, apiKeyId: string): Promise<Platform | null> {
    this.logger.debug(ctx, "PlatformRepo | findByApiKeyId", { api_key_id: apiKeyId });
    const row = await this.client(ctx).platform.findUnique({ where: { apiKeyId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async existsByApiKeyId(ctx: AppContext, apiKeyId: string): Promise<boolean> {
    this.logger.debug(ctx, "PlatformRepo | existsByApiKeyId", { api_key_id: apiKeyId });
    const count = await this.client(ctx).platform.count({ where: { apiKeyId } });
    return count > 0;
  }

  private toDomain(row: {
    id: string;
    name: string;
    apiKeyHash: string;
    apiKeyId: string;
    status: string;
    createdAt: bigint;
    updatedAt: bigint;
  }): Platform {
    return Platform.reconstruct(
      row.id,
      row.name,
      row.apiKeyHash,
      row.apiKeyId,
      row.status as PlatformStatus,
      Number(row.createdAt),
      Number(row.updatedAt),
    );
  }
}
