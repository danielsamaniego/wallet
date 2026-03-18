import type { PrismaClient } from "@prisma/client";
import type { HoldStatus } from "../../../domain/hold/entity.js";
import { Hold } from "../../../domain/hold/entity.js";
import type { HoldRepository } from "../../../domain/ports/holdRepository.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaHoldRepo implements HoldRepository {
  constructor(private readonly prisma: PrismaTransactionClient) {}

  async save(hold: Hold): Promise<void> {
    await this.prisma.hold.upsert({
      where: { id: hold.id },
      create: {
        id: hold.id,
        walletId: hold.walletId,
        amountCents: hold.amountCents,
        status: hold.status,
        reference: hold.reference,
        expiresAt: hold.expiresAt !== null ? BigInt(hold.expiresAt) : null,
        createdAt: BigInt(hold.createdAt),
        updatedAt: BigInt(hold.updatedAt),
      },
      update: {
        status: hold.status,
        updatedAt: BigInt(hold.updatedAt),
      },
    });
  }

  async findById(holdId: string): Promise<Hold | null> {
    const row = await this.prisma.hold.findUnique({ where: { id: holdId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findActiveByWallet(walletId: string): Promise<Hold[]> {
    const rows = await this.prisma.hold.findMany({
      where: { walletId, status: "active" },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async sumActiveHolds(walletId: string): Promise<bigint> {
    const result = await this.prisma.hold.aggregate({
      where: { walletId, status: "active" },
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0n;
  }

  async countActiveHolds(walletId: string): Promise<number> {
    return this.prisma.hold.count({
      where: { walletId, status: "active" },
    });
  }

  private toDomain(row: {
    id: string;
    walletId: string;
    amountCents: bigint;
    status: string;
    reference: string | null;
    expiresAt: bigint | null;
    createdAt: bigint;
    updatedAt: bigint;
  }): Hold {
    return Hold.reconstruct({
      id: row.id,
      walletId: row.walletId,
      amountCents: row.amountCents,
      status: row.status as HoldStatus,
      reference: row.reference,
      expiresAt: row.expiresAt !== null ? Number(row.expiresAt) : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    });
  }
}
