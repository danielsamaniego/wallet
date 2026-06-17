import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IWalletMovementReadStore } from "../../../../application/ports/walletMovement.readstore.js";
import type {
  PaginatedWalletMovements,
  WalletMovementDTO,
} from "../../../../application/query/getWalletMovements/query.js";

/**
 * The statement read model. Anchored on `transaction` (so the existing
 * cursor/filter engine applies to type/status/amount/reference/metadata),
 * joined to the transaction's own-wallet ledger entry (running balance + signed
 * amount) and its movement (reason). There is exactly one ledger entry per
 * (wallet, transaction): wallet-scoped reads pre-filter the include to that
 * wallet (`ledgerEntries[0]`); cross-wallet search picks the entry whose
 * walletId matches the transaction's own wallet.
 */
interface LedgerEntryFields {
  entryType: string;
  amountMinor: bigint;
  balanceAfterMinor: bigint;
}

interface MovementRowBase {
  id: string;
  walletId: string;
  counterpartWalletId: string | null;
  type: string;
  amountMinor: bigint;
  status: string;
  reference: string | null;
  metadata: unknown;
  holdId: string | null;
  movementId: string;
  createdAt: bigint;
  movement: { reason: string | null };
}

interface MovementRow extends MovementRowBase {
  ledgerEntries: LedgerEntryFields[];
}

interface SearchRow extends MovementRowBase {
  ledgerEntries: (LedgerEntryFields & { walletId: string })[];
}

export class PrismaWalletMovementReadStore implements IWalletMovementReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
  ): Promise<PaginatedWalletMovements | null> {
    this.logger.debug(ctx, "WalletMovementReadStore | getByWallet", { wallet_id: walletId });

    // Verify wallet belongs to platform (read-your-writes path → primary client).
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "WalletMovementReadStore | getByWallet wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const { where, orderBy, take } = buildPrismaListing(
      { walletId },
      listing.filters,
      listing.sort,
      listing.limit,
      listing.cursor,
      listing.jsonFilters,
    );

    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy,
      take,
      include: {
        movement: { select: { reason: true } },
        ledgerEntries: {
          where: { walletId },
          select: { entryType: true, amountMinor: true, balanceAfterMinor: true },
        },
      },
    });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const lastRow = items.at(-1);
      if (lastRow) {
        nextCursor = encodeCursor(listing.sort, lastRow as unknown as Record<string, unknown>);
      }
    }

    this.logger.debug(ctx, "WalletMovementReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      movements: items
        .map((r) => this.toDTO(r as unknown as MovementRow))
        .filter((m): m is WalletMovementDTO => m !== null),
      next_cursor: nextCursor,
    };
  }

  async getOne(
    ctx: AppContext,
    walletId: string,
    movementId: string,
    platformId: string,
  ): Promise<WalletMovementDTO | null> {
    this.logger.debug(ctx, "WalletMovementReadStore | getOne", {
      wallet_id: walletId,
      movement_id: movementId,
    });

    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "WalletMovementReadStore | getOne wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const row = await this.prisma.transaction.findFirst({
      where: { walletId, movementId },
      include: {
        movement: { select: { reason: true } },
        ledgerEntries: {
          where: { walletId },
          select: { entryType: true, amountMinor: true, balanceAfterMinor: true },
        },
      },
    });
    if (!row) {
      this.logger.info(ctx, "WalletMovementReadStore | getOne movement not found", {
        wallet_id: walletId,
        movement_id: movementId,
      });
      return null;
    }

    return this.toDTO(row as unknown as MovementRow);
  }

  async search(
    ctx: AppContext,
    platformId: string,
    q: string | undefined,
    listing: ListingQuery,
  ): Promise<PaginatedWalletMovements> {
    this.logger.debug(ctx, "WalletMovementReadStore | search", {
      platform_id: platformId,
      has_query: q !== undefined,
    });

    // Platform-scoped, cross-wallet. Free-text `q` is a case-insensitive
    // substring match on reference/reason (a pg_trgm GIN index backs it in
    // prod); structured filters (type/status/date/metadata) come via `listing`.
    const baseWhere: Record<string, unknown> = { wallet: { platformId } };
    if (q) {
      baseWhere.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { movement: { reason: { contains: q, mode: "insensitive" } } },
      ];
    }

    const { where, orderBy, take } = buildPrismaListing(
      baseWhere,
      listing.filters,
      listing.sort,
      listing.limit,
      listing.cursor,
      listing.jsonFilters,
    );

    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy,
      take,
      include: {
        movement: { select: { reason: true } },
        ledgerEntries: {
          select: { walletId: true, entryType: true, amountMinor: true, balanceAfterMinor: true },
        },
      },
    });

    const hasMore = rows.length > listing.limit;
    const items = hasMore ? rows.slice(0, listing.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const lastRow = items.at(-1);
      if (lastRow) {
        nextCursor = encodeCursor(listing.sort, lastRow as unknown as Record<string, unknown>);
      }
    }

    this.logger.debug(ctx, "WalletMovementReadStore | search result", {
      platform_id: platformId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      movements: items
        .map((r) => this.toSearchDTO(r as unknown as SearchRow))
        .filter((m): m is WalletMovementDTO => m !== null),
      next_cursor: nextCursor,
    };
  }

  private toSearchDTO(row: SearchRow): WalletMovementDTO | null {
    // Cross-wallet: pick the ledger entry belonging to the transaction's own wallet.
    const entry = row.ledgerEntries.find((e) => e.walletId === row.walletId);
    if (!entry) {
      return null;
    }
    return this.buildDTO(row, entry);
  }

  private toDTO(row: MovementRow): WalletMovementDTO | null {
    // Wallet-scoped: the include pre-filters to this wallet, so there is at most
    // one entry; a transaction with no entry for this wallet (never settled) is
    // not part of the running-balance statement.
    const entry = row.ledgerEntries[0];
    if (!entry) {
      return null;
    }
    return this.buildDTO(row, entry);
  }

  private buildDTO(row: MovementRowBase, entry: LedgerEntryFields): WalletMovementDTO {
    // amountMinor is signed in the ledger (+credit / -debit), so
    // balance_before = balance_after - signed(amount).
    const balanceBeforeMinor = entry.balanceAfterMinor - entry.amountMinor;
    return {
      movement_id: row.movementId,
      transaction_id: row.id,
      type: row.type,
      amount_minor: toSafeNumber(row.amountMinor),
      direction: entry.entryType === "CREDIT" ? "credit" : "debit",
      reason: row.movement.reason,
      reference: row.reference,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
      counterpart_wallet_id: row.counterpartWalletId,
      hold_id: row.holdId,
      status: row.status,
      balance_before_minor: toSafeNumber(balanceBeforeMinor),
      balance_after_minor: toSafeNumber(entry.balanceAfterMinor),
      created_at: toNumber(row.createdAt),
    };
  }
}
