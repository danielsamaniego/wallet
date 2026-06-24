import { describe, it, expect, vi } from "vitest";
import { PrismaWalletAnalyticsReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/walletAnalytics.readstore.js";
import { createTestContext } from "@test/helpers/builders/index.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";

const D1 = Date.parse("2024-01-01T05:00:00.000Z");
const D2 = Date.parse("2024-01-02T20:00:00.000Z");
const D3 = Date.parse("2024-01-03T20:00:00.000Z");

describe("PrismaWalletAnalyticsReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const ledgerEntry = { groupBy: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const $queryRaw = vi.fn();
    const prisma = { ledgerEntry, wallet, $queryRaw } as never;
    const logger = createMockLogger();
    const store = new PrismaWalletAnalyticsReadStore(prisma, logger);
    return { store, ledgerEntry, wallet, $queryRaw, logger };
  }

  // ── getCashFlow ──────────────────────────────────────────────────────────

  describe("getCashFlow", () => {
    it("Given the wallet does not belong to the platform, Then it returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getCashFlow(ctx, "wallet-1", "wrong-platform", D1, D2);

      expect(result).toBeNull();
    });

    it("Given credits and debits in range, Then income/expense/net/days are computed from the signed sums", async () => {
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.groupBy.mockResolvedValue([
        { entryType: "CREDIT", _sum: { amountMinor: 10000n } },
        { entryType: "DEBIT", _sum: { amountMinor: -3000n } },
      ]);

      const result = await store.getCashFlow(ctx, "wallet-1", "platform-1", D1, D2);

      expect(result).toEqual({
        income_minor: 10000,
        expense_minor: 3000,
        net_minor: 7000,
        days: 2,
      });
    });

    it("Given a group with a null sum, Then it is treated as zero", async () => {
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.groupBy.mockResolvedValue([{ entryType: "CREDIT", _sum: { amountMinor: null } }]);

      const result = await store.getCashFlow(ctx, "wallet-1", "platform-1", D1, D1);

      expect(result).toEqual({ income_minor: 0, expense_minor: 0, net_minor: 0, days: 1 });
    });
  });

  // ── getBalanceTimeseries ──────────────────────────────────────────────────

  describe("getBalanceTimeseries", () => {
    it("Given the wallet does not belong to the platform, Then it returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getBalanceTimeseries(ctx, "wallet-1", "wrong-platform", D1, D3);

      expect(result).toBeNull();
    });

    it("Given a carry-in balance and an entry mid-range, Then it carries the balance forward across days", async () => {
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.findFirst.mockResolvedValue({ balanceAfterMinor: 50n }); // carry-in
      ledgerEntry.findMany.mockResolvedValue([
        { createdAt: BigInt(Date.parse("2024-01-03T10:00:00.000Z")), balanceAfterMinor: 100n },
      ]);

      const result = await store.getBalanceTimeseries(ctx, "wallet-1", "platform-1", D1, D3);

      expect(result).toEqual({
        points: [
          { date: "2024-01-01", balance_minor: 50 },
          { date: "2024-01-02", balance_minor: 50 },
          { date: "2024-01-03", balance_minor: 100 },
        ],
      });
    });

    it("Given no prior entry and no entries in range, Then every day reports a zero balance", async () => {
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.findFirst.mockResolvedValue(null); // no carry-in
      ledgerEntry.findMany.mockResolvedValue([]);

      const result = await store.getBalanceTimeseries(ctx, "wallet-1", "platform-1", D1, D2);

      expect(result).toEqual({
        points: [
          { date: "2024-01-01", balance_minor: 0 },
          { date: "2024-01-02", balance_minor: 0 },
        ],
      });
    });
  });

  // ── aggregateMovements ─────────────────────────────────────────────────────

  describe("aggregateMovements", () => {
    const ROW = {
      bucket: "deposit",
      sum_credits_minor: 10000n,
      sum_debits_minor: -3000n,
      sum_net_minor: 7000n,
      min_minor: -3000n,
      max_minor: 10000n,
      count: 5,
    };
    const MAPPED = {
      bucket: "deposit",
      sum_net_minor: 7000,
      sum_credits_minor: 10000,
      sum_debits_minor: -3000,
      min_minor: -3000,
      max_minor: 10000,
      count: 5,
    };

    describe("Given a per-wallet scope", () => {
      it("When the wallet is missing/foreign/system, Then it returns null and never queries", async () => {
        const { store, wallet, $queryRaw } = buildReadStore();
        wallet.findFirst.mockResolvedValue(null);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          walletId: "w1",
          fromMs: D1,
          toMs: D2,
          groupBy: "type",
          direction: "all",
        });

        expect(result).toBeNull();
        expect($queryRaw).not.toHaveBeenCalled();
        expect(wallet.findFirst).toHaveBeenCalledWith({
          where: { id: "w1", platformId: "p1", isSystem: false },
          select: { id: true },
        });
      });

      it("When the wallet exists, Then it queries and maps the buckets", async () => {
        const { store, wallet, $queryRaw } = buildReadStore();
        wallet.findFirst.mockResolvedValue({ id: "w1" });
        $queryRaw.mockResolvedValue([ROW]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          walletId: "w1",
          fromMs: D1,
          toMs: D2,
          groupBy: "type",
          direction: "all",
        });

        expect(result).toEqual([MAPPED]);
        expect($queryRaw).toHaveBeenCalledTimes(1);
      });
    });

    describe("Given a platform scope", () => {
      for (const groupBy of ["type", "day", "week", "month", "owner"] as const) {
        it(`When group_by=${groupBy}, Then it queries without a wallet check and maps buckets`, async () => {
          const { store, wallet, $queryRaw } = buildReadStore();
          $queryRaw.mockResolvedValue([ROW]);

          const result = await store.aggregateMovements(ctx, {
            platformId: "p1",
            fromMs: D1,
            toMs: D2,
            groupBy,
            direction: "all",
          });

          expect(result).toEqual([MAPPED]);
          expect(wallet.findFirst).not.toHaveBeenCalled();
        });
      }

      it("When group_by=metadata with a key, Then it queries and maps buckets", async () => {
        const { store, $queryRaw } = buildReadStore();
        $queryRaw.mockResolvedValue([ROW]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          fromMs: D1,
          toMs: D2,
          groupBy: "metadata",
          direction: "all",
          metadataKey: "reasonKey",
        });

        expect(result).toEqual([MAPPED]);
      });

      it("When group_by=metadata without a key, Then it still builds the query (defensive)", async () => {
        const { store, $queryRaw } = buildReadStore();
        $queryRaw.mockResolvedValue([]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          fromMs: D1,
          toMs: D2,
          groupBy: "metadata",
          direction: "all",
        });

        expect(result).toEqual([]);
      });

      for (const direction of ["credit", "debit"] as const) {
        it(`When direction=${direction}, Then it queries and maps buckets`, async () => {
          const { store, $queryRaw } = buildReadStore();
          $queryRaw.mockResolvedValue([ROW]);

          const result = await store.aggregateMovements(ctx, {
            platformId: "p1",
            fromMs: D1,
            toMs: D2,
            groupBy: "type",
            direction,
          });

          expect(result).toEqual([MAPPED]);
        });
      }

      it("When narrowed by a metadata filter key+value, Then it queries and maps buckets", async () => {
        const { store, $queryRaw } = buildReadStore();
        $queryRaw.mockResolvedValue([ROW]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          fromMs: D1,
          toMs: D2,
          groupBy: "month",
          direction: "all",
          metadataFilterKey: "reasonKey",
          metadataFilterValue: "_MovementReasonSettlementSales",
        });

        expect(result).toEqual([MAPPED]);
        expect($queryRaw).toHaveBeenCalledTimes(1);
      });

      it("When a metadata filter key has no value, Then it falls back to an empty match (defensive)", async () => {
        const { store, $queryRaw } = buildReadStore();
        $queryRaw.mockResolvedValue([]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          fromMs: D1,
          toMs: D2,
          groupBy: "month",
          direction: "all",
          metadataFilterKey: "reasonKey",
        });

        expect(result).toEqual([]);
      });

      it("When narrowed to an owner, Then it applies the owner filter", async () => {
        const { store, $queryRaw } = buildReadStore();
        $queryRaw.mockResolvedValue([ROW]);

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          ownerId: "owner-7",
          fromMs: D1,
          toMs: D2,
          groupBy: "month",
          direction: "all",
        });

        expect(result).toEqual([MAPPED]);
      });

      it("When the bucket cap is hit, Then it warns about truncation", async () => {
        const { store, $queryRaw, logger } = buildReadStore();
        $queryRaw.mockResolvedValue(Array.from({ length: 10_000 }, () => ROW));

        const result = await store.aggregateMovements(ctx, {
          platformId: "p1",
          fromMs: D1,
          toMs: D2,
          groupBy: "owner",
          direction: "all",
        });

        expect(result).toHaveLength(10_000);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });
});
