import { Prisma, type PrismaClient } from "@prisma/client";
import { toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import {
  DAY_MS,
  dayCountInclusive,
  startOfDayMs,
  toISODate,
} from "../../../../../utils/kernel/day.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type {
  IWalletAnalyticsReadStore,
  MovementBreakdownBucketDTO,
  MovementBreakdownParams,
  MovementGroupBy,
} from "../../../../application/ports/walletAnalytics.readstore.js";
import type {
  BalancePointDTO,
  BalanceTimeSeriesResponseDTO,
} from "../../../../application/query/getBalanceTimeseries/query.js";
import type { CashFlowSummaryDTO } from "../../../../application/query/getCashFlow/query.js";

/**
 * Hard cap on returned buckets. A single platform tops out at a few thousand
 * owners today; ordering by net descending makes the common "top movers" view
 * the head of the result. Logged when hit so truncation is never silent.
 */
const MAX_BREAKDOWN_BUCKETS = 10_000;

/** Raw shape returned by the aggregation query (sums cast to bigint in SQL). */
interface MovementBreakdownRow {
  bucket: string | null;
  sum_credits_minor: bigint;
  sum_debits_minor: bigint;
  sum_net_minor: bigint;
  min_minor: bigint;
  max_minor: bigint;
  count: number;
}

export class PrismaWalletAnalyticsReadStore implements IWalletAnalyticsReadStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  private async walletExists(walletId: string, platformId: string): Promise<boolean> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, platformId },
      select: { id: true },
    });
    return wallet !== null;
  }

  async getCashFlow(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    fromMs: number,
    toMs: number,
  ): Promise<CashFlowSummaryDTO | null> {
    this.logger.debug(ctx, "WalletAnalyticsReadStore | getCashFlow", {
      wallet_id: walletId,
      from_ms: fromMs,
      to_ms: toMs,
    });

    if (!(await this.walletExists(walletId, platformId))) {
      this.logger.info(ctx, "WalletAnalyticsReadStore | getCashFlow wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ["entryType"],
      where: { walletId, createdAt: { gte: BigInt(fromMs), lte: BigInt(toMs) } },
      _sum: { amountMinor: true },
    });

    let creditSum = 0n;
    let debitSum = 0n;
    for (const g of grouped) {
      const sum = g._sum.amountMinor ?? 0n;
      if (g.entryType === "CREDIT") {
        creditSum = sum;
      } else {
        debitSum = sum; // DEBIT amounts are stored negative
      }
    }

    return {
      income_minor: toSafeNumber(creditSum),
      expense_minor: toSafeNumber(-debitSum),
      net_minor: toSafeNumber(creditSum + debitSum),
      days: dayCountInclusive(fromMs, toMs),
    };
  }

  async getBalanceTimeseries(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    fromMs: number,
    toMs: number,
  ): Promise<BalanceTimeSeriesResponseDTO | null> {
    this.logger.debug(ctx, "WalletAnalyticsReadStore | getBalanceTimeseries", {
      wallet_id: walletId,
      from_ms: fromMs,
      to_ms: toMs,
    });

    if (!(await this.walletExists(walletId, platformId))) {
      this.logger.info(ctx, "WalletAnalyticsReadStore | getBalanceTimeseries wallet not found", {
        wallet_id: walletId,
        platform_id: platformId,
      });
      return null;
    }

    const fromStart = startOfDayMs(fromMs);

    // Carry-in: the wallet's balance as of the end of the day before the range.
    const carry = await this.prisma.ledgerEntry.findFirst({
      where: { walletId, createdAt: { lt: BigInt(fromStart) } },
      orderBy: { createdAt: "desc" },
      select: { balanceAfterMinor: true },
    });
    let balance = carry?.balanceAfterMinor ?? 0n;

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId, createdAt: { gte: BigInt(fromStart), lte: BigInt(toMs) } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, balanceAfterMinor: true },
    });

    // Merge entries into the day grid: emit a point per UTC day carrying the
    // running balance forward; the last entry of a day sets that day's balance.
    const points: BalancePointDTO[] = [];
    let dayStart = fromStart;
    for (const e of entries) {
      // entries are filtered createdAt <= toMs, so entryDay <= toMs; therefore
      // `dayStart < entryDay` already implies `dayStart <= toMs` (no extra guard).
      const entryDay = startOfDayMs(Number(e.createdAt));
      while (dayStart < entryDay) {
        points.push({ date: toISODate(dayStart), balance_minor: toSafeNumber(balance) });
        dayStart += DAY_MS;
      }
      balance = e.balanceAfterMinor;
    }
    while (dayStart <= toMs) {
      points.push({ date: toISODate(dayStart), balance_minor: toSafeNumber(balance) });
      dayStart += DAY_MS;
    }

    this.logger.debug(ctx, "WalletAnalyticsReadStore | getBalanceTimeseries result", {
      wallet_id: walletId,
      points: points.length,
    });

    return { points };
  }

  /**
   * SQL expression the breakdown groups by. Everything except `metadata` is a
   * fixed, safe fragment chosen from the validated `groupBy` enum. `metadata`
   * extracts a consumer-supplied JSON key bound as a parameter (never
   * interpolated), so the service stays agnostic and injection-safe. Time
   * buckets are computed in UTC from the Unix-ms `created_at`.
   */
  private breakdownBucketSql(groupBy: MovementGroupBy, metadataKey?: string): Prisma.Sql {
    switch (groupBy) {
      case "type":
        return Prisma.sql`m.type`;
      case "owner":
        return Prisma.sql`w.owner_id`;
      case "day":
        return Prisma.sql`to_char(to_timestamp(le.created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
      case "week":
        return Prisma.sql`to_char(to_timestamp(le.created_at / 1000.0) AT TIME ZONE 'UTC', 'IYYY-"W"IW')`;
      case "month":
        return Prisma.sql`to_char(to_timestamp(le.created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM')`;
      case "metadata":
        return Prisma.sql`t.metadata ->> ${metadataKey ?? ""}`;
    }
  }

  async aggregateMovements(
    ctx: AppContext,
    params: MovementBreakdownParams,
  ): Promise<MovementBreakdownBucketDTO[] | null> {
    this.logger.debug(ctx, "WalletAnalyticsReadStore | aggregateMovements", {
      platform_id: params.platformId,
      wallet_id: params.walletId,
      owner_id: params.ownerId,
      group_by: params.groupBy,
      direction: params.direction,
      from_ms: params.fromMs,
      to_ms: params.toMs,
    });

    // Per-wallet scope must 404 on a missing/foreign/system wallet (system
    // wallets are internal and never exposed) → signalled with null.
    if (params.walletId !== undefined) {
      const wallet = await this.prisma.wallet.findFirst({
        where: { id: params.walletId, platformId: params.platformId, isSystem: false },
        select: { id: true },
      });
      if (!wallet) {
        this.logger.info(ctx, "WalletAnalyticsReadStore | aggregateMovements wallet not found", {
          wallet_id: params.walletId,
          platform_id: params.platformId,
        });
        return null;
      }
    }

    const bucket = this.breakdownBucketSql(params.groupBy, params.metadataKey);
    const walletFilter =
      params.walletId !== undefined
        ? Prisma.sql`AND le.wallet_id = ${params.walletId}`
        : Prisma.empty;
    const ownerFilter =
      params.ownerId !== undefined ? Prisma.sql`AND w.owner_id = ${params.ownerId}` : Prisma.empty;
    const directionFilter =
      params.direction === "credit"
        ? Prisma.sql`AND le.entry_type = 'CREDIT'`
        : params.direction === "debit"
          ? Prisma.sql`AND le.entry_type = 'DEBIT'`
          : Prisma.empty;
    // Optional pre-aggregation narrowing on an arbitrary JSON key — the key and
    // value are bound as parameters (never interpolated), so the service stays
    // agnostic and injection-safe. Validated as a pair at the HTTP layer.
    const metadataFilter =
      params.metadataFilterKey !== undefined
        ? Prisma.sql`AND t.metadata ->> ${params.metadataFilterKey} = ${params.metadataFilterValue ?? ""}`
        : Prisma.empty;

    // Sum the wallet's OWN signed ledger entries (CREDIT > 0, DEBIT < 0).
    // System (omnibus) wallets are excluded: by double-entry they are the
    // counterpart of every user movement, so including them would net the
    // platform total to zero. Excluding them yields the real flow of money
    // to/from users — what a breakdown is about. INNER joins are safe: every
    // ledger entry has exactly one transaction and one movement.
    const rows = await this.prisma.$queryRaw<MovementBreakdownRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket,
             COALESCE(SUM(le.amount_minor) FILTER (WHERE le.entry_type = 'CREDIT'), 0)::bigint AS sum_credits_minor,
             COALESCE(SUM(le.amount_minor) FILTER (WHERE le.entry_type = 'DEBIT'), 0)::bigint AS sum_debits_minor,
             COALESCE(SUM(le.amount_minor), 0)::bigint AS sum_net_minor,
             COALESCE(MIN(le.amount_minor), 0)::bigint AS min_minor,
             COALESCE(MAX(le.amount_minor), 0)::bigint AS max_minor,
             COUNT(*)::int AS count
      FROM ledger_entries le
      JOIN wallets w ON w.id = le.wallet_id
      JOIN transactions t ON t.id = le.transaction_id
      JOIN movements m ON m.id = le.movement_id
      WHERE w.platform_id = ${params.platformId}
        AND w.is_system = false
        AND le.created_at >= ${BigInt(params.fromMs)}
        AND le.created_at <= ${BigInt(params.toMs)}
        ${walletFilter}
        ${ownerFilter}
        ${directionFilter}
        ${metadataFilter}
      GROUP BY bucket
      ORDER BY sum_net_minor DESC
      LIMIT ${MAX_BREAKDOWN_BUCKETS}
    `);

    if (rows.length === MAX_BREAKDOWN_BUCKETS) {
      this.logger.warn(ctx, "WalletAnalyticsReadStore | aggregateMovements bucket cap hit", {
        platform_id: params.platformId,
        group_by: params.groupBy,
        cap: MAX_BREAKDOWN_BUCKETS,
      });
    }

    return rows.map((r) => ({
      bucket: r.bucket,
      sum_net_minor: toSafeNumber(r.sum_net_minor),
      sum_credits_minor: toSafeNumber(r.sum_credits_minor),
      sum_debits_minor: toSafeNumber(r.sum_debits_minor),
      min_minor: toSafeNumber(r.min_minor),
      max_minor: toSafeNumber(r.max_minor),
      count: r.count,
    }));
  }
}
