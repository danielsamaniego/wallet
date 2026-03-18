import type { PrismaClient } from "@prisma/client";
import { toNumber, toSafeNumber } from "../../../../shared/kernel/bigint.js";
import type { WalletDTO, WalletReadStore } from "../../../app/query/getWallet/handler.js";

export class PrismaWalletReadStore implements WalletReadStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getById(walletId: string, platformId: string): Promise<WalletDTO | null> {
    const row = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
    });

    if (!row) return null;

    // Calculate available balance: cached - active holds
    const holdSum = await this.prisma.hold.aggregate({
      where: { walletId: row.id, status: "active" },
      _sum: { amountCents: true },
    });

    const activeHolds = holdSum._sum.amountCents ?? 0n;
    const availableBalance = row.cachedBalanceCents - activeHolds;

    return {
      id: row.id,
      owner_id: row.ownerId,
      platform_id: row.platformId,
      currency_code: row.currencyCode,
      balance_cents: toSafeNumber(row.cachedBalanceCents),
      available_balance_cents: toSafeNumber(availableBalance),
      status: row.status,
      is_system: row.isSystem,
      created_at: toNumber(row.createdAt),
      updated_at: toNumber(row.updatedAt),
    };
  }
}
