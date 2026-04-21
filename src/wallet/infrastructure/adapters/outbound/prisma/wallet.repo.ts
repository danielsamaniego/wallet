import type { PrismaClient } from "@prisma/client";
import type { IIDGenerator } from "../../../../../utils/application/id.generator.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../../domain/ports/wallet.repository.js";
import { Wallet, type WalletStatus } from "../../../../domain/wallet/wallet.aggregate.js";
import {
  ErrSystemWalletNotFound,
  ErrVersionConflict,
} from "../../../../domain/wallet/wallet.errors.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaWalletRepo implements IWalletRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
    private readonly idGen: IIDGenerator,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async save(ctx: AppContext, wallet: Wallet): Promise<void> {
    this.logger.debug(ctx, "WalletRepo | save", {
      wallet_id: wallet.id,
      currency_code: wallet.currencyCode,
      version: wallet.version,
    });
    const db = this.client(ctx);
    if (wallet.version === 1) {
      this.logger.debug(ctx, "WalletRepo | save creating new wallet", { wallet_id: wallet.id });
      await db.wallet.create({
        data: {
          id: wallet.id,
          ownerId: wallet.ownerId,
          platformId: wallet.platformId,
          currencyCode: wallet.currencyCode,
          cachedBalanceMinor: wallet.cachedBalanceMinor,
          status: wallet.status,
          version: wallet.version,
          isSystem: wallet.isSystem,
          shardIndex: wallet.shardIndex,
          createdAt: BigInt(wallet.createdAt),
          updatedAt: BigInt(wallet.updatedAt),
        },
      });
    } else {
      const previousVersion = wallet.version - 1;
      const result = await db.wallet.updateMany({
        where: { id: wallet.id, version: previousVersion },
        data: {
          cachedBalanceMinor: wallet.cachedBalanceMinor,
          status: wallet.status,
          version: wallet.version,
          updatedAt: BigInt(wallet.updatedAt),
        },
      });
      if (result.count === 0) {
        this.logger.warn(ctx, "WalletRepo | save version conflict", {
          wallet_id: wallet.id,
          currency_code: wallet.currencyCode,
          expected_version: previousVersion,
        });
        throw ErrVersionConflict();
      }
    }
  }

  async adjustSystemShardBalance(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
    shardIndex: number,
    deltaMinor: bigint,
    now: number,
  ): Promise<{ walletId: string; cachedBalanceMinor: bigint }> {
    const methodLogTag = "WalletRepo | adjustSystemShardBalance";
    const upperCurrency = currencyCode.toUpperCase();
    this.logger.debug(ctx, `${methodLogTag}`, {
      platform_id: platformId,
      currency_code: upperCurrency,
      shard_index: shardIndex,
      delta_minor: Number(deltaMinor),
    });
    const db = this.client(ctx);
    try {
      // Single UPDATE ... RETURNING locating the shard via the 4-tuple unique.
      // No pre-SELECT: avoids read-write dependencies that SERIALIZABLE would
      // abort under cross-wallet concurrency.
      const updated = await db.wallet.update({
        where: {
          ownerId_platformId_currencyCode_shardIndex: {
            ownerId: "SYSTEM",
            platformId,
            currencyCode: upperCurrency,
            shardIndex,
          },
        },
        data: {
          cachedBalanceMinor: { increment: deltaMinor },
          updatedAt: BigInt(now),
        },
        select: { id: true, cachedBalanceMinor: true },
      });
      return {
        walletId: updated.id,
        cachedBalanceMinor: updated.cachedBalanceMinor,
      };
    } catch (err) {
      // Prisma P2025 = Record not found. Surface as a domain-level error so
      // callers know they need to ensure shards exist (createWallet path).
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
        this.logger.warn(ctx, `${methodLogTag} shard not found`, {
          platform_id: platformId,
          currency_code: upperCurrency,
          shard_index: shardIndex,
        });
        throw ErrSystemWalletNotFound(platformId, upperCurrency);
      }
      throw err;
    }
  }

  async findById(ctx: AppContext, walletId: string): Promise<Wallet | null> {
    this.logger.debug(ctx, "WalletRepo | findById", { wallet_id: walletId });
    const row = await this.client(ctx).wallet.findUnique({ where: { id: walletId } });
    if (!row) {
      this.logger.debug(ctx, "WalletRepo | findById not found", { wallet_id: walletId });
      return null;
    }
    return this.toDomain(row);
  }

  async findByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null> {
    this.logger.debug(ctx, "WalletRepo | findByOwner", {
      owner_id: ownerId,
      platform_id: platformId,
      currency_code: currencyCode,
    });
    const row = await this.client(ctx).wallet.findUnique({
      where: {
        ownerId_platformId_currencyCode_shardIndex: {
          ownerId,
          platformId,
          currencyCode: currencyCode.toUpperCase(),
          // User wallets are always shard 0 (they are their own shard 0).
          shardIndex: 0,
        },
      },
    });
    if (!row) {
      this.logger.debug(ctx, "WalletRepo | findByOwner not found", {
        owner_id: ownerId,
        platform_id: platformId,
        currency_code: currencyCode,
      });
      return null;
    }
    return this.toDomain(row);
  }

  async ensureSystemWalletShards(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
    shardCount: number,
    now: number,
  ): Promise<void> {
    const methodLogTag = "WalletRepo | ensureSystemWalletShards";
    const upperCurrency = currencyCode.toUpperCase();
    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: platformId,
      currency_code: upperCurrency,
      shard_count: shardCount,
    });
    const db = this.client(ctx);
    // Read the set of existing shards so we can insert only the missing ones.
    // `skipDuplicates` below is still the atomicity guarantee — the pre-read is
    // only an optimisation to avoid hitting the DB with a full N-row INSERT on
    // the common case where the shards already exist.
    const existing = await db.wallet.findMany({
      where: { platformId, currencyCode: upperCurrency, isSystem: true },
      select: { shardIndex: true },
    });
    const existingSet = new Set(existing.map((r) => r.shardIndex));
    const missing: number[] = [];
    for (let i = 0; i < shardCount; i++) {
      if (!existingSet.has(i)) missing.push(i);
    }
    if (missing.length === 0) {
      this.logger.debug(ctx, `${methodLogTag} no-op`, {
        platform_id: platformId,
        currency_code: upperCurrency,
        existing_count: existing.length,
      });
      return;
    }
    const nowBig = BigInt(now);
    await db.wallet.createMany({
      data: missing.map((idx) => ({
        id: this.idGen.newId(),
        ownerId: "SYSTEM",
        platformId,
        currencyCode: upperCurrency,
        cachedBalanceMinor: 0n,
        status: "active",
        version: 1,
        isSystem: true,
        shardIndex: idx,
        createdAt: nowBig,
        updatedAt: nowBig,
      })),
      // ON CONFLICT DO NOTHING — concurrent requests trying to create the same
      // shard both succeed idempotently (the second produces zero rows affected).
      skipDuplicates: true,
    });
    this.logger.info(ctx, `${methodLogTag} inserted`, {
      platform_id: platformId,
      currency_code: upperCurrency,
      inserted: missing.length,
      shard_count: shardCount,
    });
  }

  async listSystemWalletCurrencies(ctx: AppContext, platformId: string): Promise<string[]> {
    this.logger.debug(ctx, "WalletRepo | listSystemWalletCurrencies", {
      platform_id: platformId,
    });
    const rows = await this.client(ctx).wallet.findMany({
      where: { platformId, isSystem: true },
      select: { currencyCode: true },
      distinct: ["currencyCode"],
    });
    return rows.map((r) => r.currencyCode);
  }

  async sumSystemWalletBalance(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
  ): Promise<{ cachedBalanceMinor: bigint; shardCount: number }> {
    const methodLogTag = "WalletRepo | sumSystemWalletBalance";
    const upperCurrency = currencyCode.toUpperCase();
    this.logger.debug(ctx, `${methodLogTag} start`, {
      platform_id: platformId,
      currency_code: upperCurrency,
    });
    const db = this.client(ctx);
    const result = await db.wallet.aggregate({
      where: { platformId, currencyCode: upperCurrency, isSystem: true },
      _sum: { cachedBalanceMinor: true },
      _count: { _all: true },
    });
    return {
      cachedBalanceMinor: result._sum.cachedBalanceMinor ?? 0n,
      shardCount: result._count._all,
    };
  }

  async existsByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<boolean> {
    this.logger.debug(ctx, "WalletRepo | existsByOwner", {
      owner_id: ownerId,
      platform_id: platformId,
      currency_code: currencyCode,
    });
    const row = await this.client(ctx).wallet.findUnique({
      where: {
        ownerId_platformId_currencyCode_shardIndex: {
          ownerId,
          platformId,
          currencyCode: currencyCode.toUpperCase(),
          shardIndex: 0,
        },
      },
      select: { id: true },
    });
    return row !== null;
  }

  private toDomain(row: {
    id: string;
    ownerId: string;
    platformId: string;
    currencyCode: string;
    cachedBalanceMinor: bigint;
    status: string;
    version: number;
    isSystem: boolean;
    shardIndex: number;
    createdAt: bigint;
    updatedAt: bigint;
  }): Wallet {
    return Wallet.reconstruct(
      row.id,
      row.ownerId,
      row.platformId,
      row.currencyCode,
      row.cachedBalanceMinor,
      row.status as WalletStatus,
      row.version,
      row.isSystem,
      row.shardIndex,
      Number(row.createdAt),
      Number(row.updatedAt),
    );
  }
}
