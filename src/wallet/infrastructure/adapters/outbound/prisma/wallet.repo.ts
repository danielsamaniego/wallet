import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IWalletRepository } from "../../../../domain/ports/wallet.repository.js";
import { Wallet, type WalletStatus } from "../../../../domain/wallet/wallet.aggregate.js";
import { ErrVersionConflict } from "../../../../domain/wallet/wallet.errors.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaWalletRepo implements IWalletRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
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

  async adjustSystemWalletBalance(
    ctx: AppContext,
    walletId: string,
    deltaMinor: bigint,
    now: number,
  ): Promise<void> {
    this.logger.debug(ctx, "WalletRepo | adjustSystemWalletBalance", {
      wallet_id: walletId,
      delta_minor: Number(deltaMinor),
    });
    const db = this.client(ctx);
    await db.wallet.update({
      where: { id: walletId },
      data: {
        cachedBalanceMinor: { increment: deltaMinor },
        updatedAt: BigInt(now),
      },
    });
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
        ownerId_platformId_currencyCode: {
          ownerId,
          platformId,
          currencyCode: currencyCode.toUpperCase(),
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

  async findSystemWallet(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null> {
    this.logger.debug(ctx, "WalletRepo | findSystemWallet", {
      platform_id: platformId,
      currency_code: currencyCode,
    });
    const row = await this.client(ctx).wallet.findUnique({
      where: {
        ownerId_platformId_currencyCode: {
          ownerId: "SYSTEM",
          platformId,
          currencyCode: currencyCode.toUpperCase(),
        },
      },
    });
    if (!row) {
      this.logger.debug(ctx, "WalletRepo | findSystemWallet not found", {
        platform_id: platformId,
        currency_code: currencyCode,
      });
      return null;
    }
    return this.toDomain(row);
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
    const count = await this.client(ctx).wallet.count({
      where: { ownerId, platformId, currencyCode: currencyCode.toUpperCase() },
    });
    return count > 0;
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
      Number(row.createdAt),
      Number(row.updatedAt),
    );
  }
}
