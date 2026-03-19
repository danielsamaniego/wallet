import type { PrismaClient } from "@prisma/client";
import { toNumber, toSafeNumber } from "../../../../shared/domain/kernel/bigint.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { IWalletReadStore, WalletDTO } from "../../../application/query/getWallet/query.js";

export class PrismaWalletReadStore implements IWalletReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getById(ctx: AppContext, walletId: string, platformId: string): Promise<WalletDTO | null> {
    this.logger.debug(ctx, "WalletReadStore | getById", { wallet_id: walletId });
    const row = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
    });

    if (!row) return null;

    // Calculate available balance: cached - active holds (excluding expired by time)
    const now = BigInt(Date.now());
    const holdSum = await this.prisma.hold.aggregate({
      where: {
        walletId: row.id,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { amountCents: true },
    });

    const activeHolds = holdSum._sum.amountCents ?? 0n;
    const rawAvailable = row.cachedBalanceCents - activeHolds;
    const availableBalance = rawAvailable < 0n ? 0n : rawAvailable;

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
