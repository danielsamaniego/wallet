import type { PrismaClient } from "@prisma/client";
import { toSafeNumber } from "../../../../../utils/kernel/bigint.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import {
  DAY_MS,
  dayCountInclusive,
  startOfDayMs,
  toISODate,
} from "../../../../../utils/kernel/day.js";
import type { ILogger } from "../../../../../utils/kernel/observability/logger.port.js";
import type { IWalletAnalyticsReadStore } from "../../../../application/ports/walletAnalytics.readstore.js";
import type {
  BalancePointDTO,
  BalanceTimeSeriesResponseDTO,
} from "../../../../application/query/getBalanceTimeseries/query.js";
import type { MoneyFlowSummaryDTO } from "../../../../application/query/getMoneyFlow/query.js";

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

  async getMoneyFlow(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    fromMs: number,
    toMs: number,
  ): Promise<MoneyFlowSummaryDTO | null> {
    this.logger.debug(ctx, "WalletAnalyticsReadStore | getMoneyFlow", {
      wallet_id: walletId,
      from_ms: fromMs,
      to_ms: toMs,
    });

    if (!(await this.walletExists(walletId, platformId))) {
      this.logger.info(ctx, "WalletAnalyticsReadStore | getMoneyFlow wallet not found", {
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
}
