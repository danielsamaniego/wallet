import type { PrismaClient } from "@prisma/client";
import { toNumber, toSafeNumber } from "../../../../shared/domain/kernel/bigint.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type {
  ILedgerEntryReadStore,
  LedgerEntryDTO,
  PaginatedLedgerEntries,
} from "../../../application/query/getLedgerEntries/query.js";

export class PrismaLedgerEntryReadStore implements ILedgerEntryReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedLedgerEntries | null> {
    this.logger.debug(ctx, "LedgerEntryReadStore | getByWallet", { wallet_id: walletId });
    // Verify wallet belongs to platform
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "LedgerEntryReadStore | getByWallet wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    this.logger.debug(ctx, "LedgerEntryReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      ledger_entries: items.map((r) => this.toDTO(r)),
      next_cursor: hasMore && items.length > 0 ? items[items.length - 1]!.id : null,
    };
  }

  private toDTO(row: {
    id: string;
    transactionId: string;
    walletId: string;
    entryType: string;
    amountCents: bigint;
    balanceAfterCents: bigint;
    createdAt: bigint;
  }): LedgerEntryDTO {
    return {
      id: row.id,
      transaction_id: row.transactionId,
      wallet_id: row.walletId,
      entry_type: row.entryType,
      amount_cents: toSafeNumber(row.amountCents),
      balance_after_cents: toSafeNumber(row.balanceAfterCents),
      created_at: toNumber(row.createdAt),
    };
  }
}
