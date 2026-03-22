import type { PrismaClient } from "@prisma/client";
import type {
  IdempotencyRecord,
  IIdempotencyStore,
} from "../http/middleware/idempotency.js";

export class PrismaIdempotencyStore implements IIdempotencyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly idGen: { newId(): string },
  ) {}

  async acquire(
    idempotencyKey: string,
    platformId: string,
    requestHash: string,
    createdAt: number,
    expiresAt: number,
  ): Promise<IdempotencyRecord | null> {
    // Try to find existing
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return {
        idempotencyKey: existing.idempotencyKey,
        platformId: existing.platformId,
        requestHash: existing.requestHash,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
        createdAt: Number(existing.createdAt),
        expiresAt: Number(existing.expiresAt),
      };
    }

    // Try to insert — race condition handled by unique constraint
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          id: this.idGen.newId(),
          idempotencyKey,
          platformId,
          requestHash,
          responseStatus: 0,
          responseBody: {},
          createdAt: BigInt(createdAt),
          expiresAt: BigInt(expiresAt),
        },
      });
      return null; // This caller won
    } catch (err: unknown) {
      // Unique constraint violation — another request won the race
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          idempotencyKey: existing.idempotencyKey,
          platformId: existing.platformId,
          requestHash: existing.requestHash,
          responseStatus: existing.responseStatus,
          responseBody: existing.responseBody,
          createdAt: Number(existing.createdAt),
          expiresAt: Number(existing.expiresAt),
        };
      }
      throw err;
    }
  }

  async complete(
    idempotencyKey: string,
    _platformId: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { idempotencyKey },
      data: {
        responseStatus,
        responseBody: responseBody as any,
      },
    });
  }

  async release(idempotencyKey: string, _platformId: string): Promise<void> {
    await this.prisma.idempotencyRecord.delete({
      where: { idempotencyKey },
    });
  }
}
