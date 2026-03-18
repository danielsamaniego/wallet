import type { PrismaClient } from "@prisma/client";
import type { WalletRepository } from "../../../domain/ports/walletRepository.js";
import { Wallet } from "../../../domain/wallet/aggregate.js";
import { ErrVersionConflict } from "../../../domain/wallet/errors.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaWalletRepo implements WalletRepository {
  constructor(private readonly prisma: PrismaTransactionClient) {}

  async save(wallet: Wallet): Promise<void> {
    if (wallet.version === 0) {
      await this.prisma.wallet.create({
        data: {
          id: wallet.id,
          ownerId: wallet.ownerId,
          platformId: wallet.platformId,
          currencyCode: wallet.currencyCode,
          cachedBalanceCents: wallet.cachedBalanceCents,
          status: wallet.status,
          version: 1,
          isSystem: wallet.isSystem,
          createdAt: BigInt(wallet.createdAt),
          updatedAt: BigInt(wallet.updatedAt),
        },
      });
    } else {
      // Optimistic locking: version must match
      const result = await this.prisma.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: {
          cachedBalanceCents: wallet.cachedBalanceCents,
          status: wallet.status,
          version: wallet.version + 1,
          updatedAt: BigInt(wallet.updatedAt),
        },
      });

      if (result.count === 0) {
        throw ErrVersionConflict();
      }
    }
  }

  async findById(walletId: string): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByOwner(
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({
      where: {
        ownerId_platformId_currencyCode: {
          ownerId,
          platformId,
          currencyCode: currencyCode.toUpperCase(),
        },
      },
    });
    if (!row) return null;
    return this.toDomain(row);
  }

  async findSystemWallet(platformId: string, currencyCode: string): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({
      where: {
        ownerId_platformId_currencyCode: {
          ownerId: "SYSTEM",
          platformId,
          currencyCode: currencyCode.toUpperCase(),
        },
      },
    });
    if (!row) return null;
    return this.toDomain(row);
  }

  async existsByOwner(ownerId: string, platformId: string, currencyCode: string): Promise<boolean> {
    const count = await this.prisma.wallet.count({
      where: {
        ownerId,
        platformId,
        currencyCode: currencyCode.toUpperCase(),
      },
    });
    return count > 0;
  }

  private toDomain(row: {
    id: string;
    ownerId: string;
    platformId: string;
    currencyCode: string;
    cachedBalanceCents: bigint;
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
      row.cachedBalanceCents,
      row.status,
      row.version,
      row.isSystem,
      Number(row.createdAt),
      Number(row.updatedAt),
    );
  }
}
