import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { HoldStatus } from "../../../domain/hold/hold.entity.js";
import { Hold } from "../../../domain/hold/hold.entity.js";
import type { IHoldRepository } from "../../../domain/ports/hold.repository.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaHoldRepo implements IHoldRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async save(ctx: AppContext, hold: Hold): Promise<void> {
    this.logger.debug(ctx, "HoldRepo | save", { hold_id: hold.id, status: hold.status });
    await this.client(ctx).hold.upsert({
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
      update: { status: hold.status, updatedAt: BigInt(hold.updatedAt) },
    });
  }

  async findById(ctx: AppContext, holdId: string): Promise<Hold | null> {
    this.logger.debug(ctx, "HoldRepo | findById", { hold_id: holdId });
    const row = await this.client(ctx).hold.findUnique({ where: { id: holdId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findActiveByWallet(ctx: AppContext, walletId: string): Promise<Hold[]> {
    this.logger.debug(ctx, "HoldRepo | findActiveByWallet", { wallet_id: walletId });
    const rows = await this.client(ctx).hold.findMany({
      where: this.activeHoldFilter(walletId),
    });
    return rows.map((r) => this.toDomain(r));
  }

  async sumActiveHolds(ctx: AppContext, walletId: string): Promise<bigint> {
    this.logger.debug(ctx, "HoldRepo | sumActiveHolds", { wallet_id: walletId });
    const result = await this.client(ctx).hold.aggregate({
      where: this.activeHoldFilter(walletId),
      _sum: { amountCents: true },
    });
    return result._sum.amountCents ?? 0n;
  }

  async countActiveHolds(ctx: AppContext, walletId: string): Promise<number> {
    this.logger.debug(ctx, "HoldRepo | countActiveHolds", { wallet_id: walletId });
    return this.client(ctx).hold.count({ where: this.activeHoldFilter(walletId) });
  }

  /** Filter: status = 'active' AND not expired by time. */
  private activeHoldFilter(walletId: string) {
    const now = BigInt(Date.now());
    return {
      walletId,
      status: "active" as const,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
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
