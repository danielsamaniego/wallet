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
    const prisma = { ledgerEntry, wallet } as never;
    const logger = createMockLogger();
    const store = new PrismaWalletAnalyticsReadStore(prisma, logger);
    return { store, ledgerEntry, wallet };
  }

  // ── getMoneyFlow ──────────────────────────────────────────────────────────

  describe("getMoneyFlow", () => {
    it("Given the wallet does not belong to the platform, Then it returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getMoneyFlow(ctx, "wallet-1", "wrong-platform", D1, D2);

      expect(result).toBeNull();
    });

    it("Given credits and debits in range, Then income/expense/net/days are computed from the signed sums", async () => {
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.groupBy.mockResolvedValue([
        { entryType: "CREDIT", _sum: { amountMinor: 10000n } },
        { entryType: "DEBIT", _sum: { amountMinor: -3000n } },
      ]);

      const result = await store.getMoneyFlow(ctx, "wallet-1", "platform-1", D1, D2);

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

      const result = await store.getMoneyFlow(ctx, "wallet-1", "platform-1", D1, D1);

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
});
