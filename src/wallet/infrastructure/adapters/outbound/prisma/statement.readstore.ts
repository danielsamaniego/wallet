import type { PrismaClient } from "@prisma/client";
import { buildPrismaListing } from "../../../../../utils/infrastructure/listing.prisma.js";
import { toNumber, toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type { ListingQuery } from "../../../../../utils/kernel/listing.js";
import { encodeCursor } from "../../../../../utils/kernel/listing.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IStatementReadStore } from "../../../../application/ports/statement.readstore.js";
import type {
  PaginatedStatement,
  StatementEntryDTO,
} from "../../../../application/query/getStatement/query.js";

/**
 * The statement read model. Anchored on `transaction` (so the existing
 * cursor/filter engine applies to type/status/amount/reference/metadata),
 * joined to the wallet's own ledger entry (running balance + signed amount) and
 * its movement (reason). The include pre-filters the ledger entry to this
 * wallet, so `ledgerEntries[0]` is the wallet's own side (exactly one per
 * (wallet, transaction)).
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

/**
 * Escapes SQL LIKE wildcards so free-text search is matched literally. Prisma's
 * `contains` compiles to `ILIKE '%value%'` without escaping, so a raw `_`/`%`/`\`
 * would behave as a wildcard. Postgres LIKE uses `\` as the default escape char.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export class PrismaStatementReadStore implements IStatementReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async getByWallet(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    listing: ListingQuery,
    q?: string,
  ): Promise<PaginatedStatement | null> {
    this.logger.debug(ctx, "StatementReadStore | getByWallet", {
      wallet_id: walletId,
      has_query: q !== undefined,
    });

    // Verify wallet belongs to platform (read-your-writes path → primary client).
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "StatementReadStore | getByWallet wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    // Free-text `q` is a case-insensitive substring match on reference/reason,
    // confined to this wallet (the walletId filter already bounds the scan).
    // LIKE wildcards in the user input are escaped so they match literally —
    // otherwise `_`/`%` would act as wildcards (over-matching / probing).
    // Only transactions that have a ledger entry for THIS wallet are part of the
    // running-balance statement. Enforcing it in the WHERE (not just by dropping
    // entry-less rows after mapping) keeps has_more / next_cursor exact: an
    // entry-less transaction can never consume a page slot and leave the client
    // with a short or empty page that still carries a next_cursor. Today the
    // write path always pairs a transaction with its ledger entries atomically,
    // so this is a defensive invariant rather than a reachable state.
    const baseWhere: Record<string, unknown> = {
      walletId,
      ledgerEntries: { some: { walletId } },
    };
    if (q) {
      const term = escapeLike(q);
      baseWhere.OR = [
        { reference: { contains: term, mode: "insensitive" } },
        { movement: { reason: { contains: term, mode: "insensitive" } } },
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

    this.logger.debug(ctx, "StatementReadStore | getByWallet result", {
      wallet_id: walletId,
      count: items.length,
      has_more: hasMore,
    });

    return {
      entries: items
        .map((r) => this.toDTO(r as unknown as MovementRow))
        .filter((m): m is StatementEntryDTO => m !== null),
      next_cursor: nextCursor,
    };
  }

  async getOne(
    ctx: AppContext,
    walletId: string,
    movementId: string,
    platformId: string,
  ): Promise<StatementEntryDTO | null> {
    this.logger.debug(ctx, "StatementReadStore | getOne", {
      wallet_id: walletId,
      movement_id: movementId,
    });

    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    if (!wallet) {
      this.logger.info(ctx, "StatementReadStore | getOne wallet not found", {
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
      this.logger.info(ctx, "StatementReadStore | getOne movement not found", {
        wallet_id: walletId,
        movement_id: movementId,
      });
      return null;
    }

    return this.toDTO(row as unknown as MovementRow);
  }

  private toDTO(row: MovementRow): StatementEntryDTO | null {
    // Wallet-scoped: the include pre-filters to this wallet, so there is at most
    // one entry; a transaction with no entry for this wallet (never settled) is
    // not part of the running-balance statement.
    const entry = row.ledgerEntries[0];
    if (!entry) {
      return null;
    }
    return this.buildDTO(row, entry);
  }

  private buildDTO(row: MovementRowBase, entry: LedgerEntryFields): StatementEntryDTO {
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
