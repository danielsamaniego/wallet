import { describe, it, expect, vi } from "vitest";
import { PrismaStatementReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/statement.readstore.js";
import { createTestContext } from "@test/helpers/builders/index.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";

function defaultListing(overrides?: Partial<ListingQuery>): ListingQuery {
  return {
    filters: [],
    sort: [{ field: "createdAt", direction: "desc" as const }],
    limit: 20,
    ...overrides,
  };
}

function buildMovementRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "txn-1",
    walletId: "wallet-1",
    counterpartWalletId: "wallet-2",
    type: "transfer_out",
    amountMinor: 5000n,
    status: "completed",
    reference: "ref-1",
    metadata: { order_id: "order-1" },
    holdId: null,
    movementId: "mv-1",
    createdAt: 1700000000000n,
    movement: { reason: "manual" },
    ledgerEntries: [{ entryType: "DEBIT", amountMinor: -5000n, balanceAfterMinor: 5000n }],
    ...overrides,
  };
}

describe("PrismaStatementReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const transaction = { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const prisma = { transaction, wallet } as never;
    const logger = createMockLogger();
    const store = new PrismaStatementReadStore(prisma, logger);
    return { store, transaction, wallet };
  }

  describe("getByWallet", () => {
    it("Given the wallet does not belong to the platform, When getByWallet is called, Then it returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getByWallet(ctx, "wallet-1", "wrong-platform", defaultListing());

      expect(result).toBeNull();
    });

    it("Given a debit and a credit movement, When getByWallet is called, Then it maps direction, signed running balance and metadata", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        // debit (transfer_out): balance_after 5000, ledger amount -5000 -> before 10000
        buildMovementRow(),
        // credit (deposit) with null metadata and null reason: before = after - amount = 0
        buildMovementRow({
          id: "txn-2",
          type: "deposit",
          counterpartWalletId: null,
          amountMinor: 10000n,
          reference: null,
          metadata: null,
          movementId: "mv-2",
          movement: { reason: null },
          ledgerEntries: [{ entryType: "CREDIT", amountMinor: 10000n, balanceAfterMinor: 10000n }],
        }),
      ]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(2);

      expect(result!.entries[0]).toEqual({
        movement_id: "mv-1",
        transaction_id: "txn-1",
        type: "transfer_out",
        amount_minor: 5000,
        direction: "debit",
        reason: "manual",
        reference: "ref-1",
        metadata: { order_id: "order-1" },
        counterpart_wallet_id: "wallet-2",
        hold_id: null,
        status: "completed",
        balance_before_minor: 10000,
        balance_after_minor: 5000,
        created_at: 1700000000000,
      });

      expect(result!.entries[1]).toEqual({
        movement_id: "mv-2",
        transaction_id: "txn-2",
        type: "deposit",
        amount_minor: 10000,
        direction: "credit",
        reason: null,
        reference: null,
        metadata: null,
        counterpart_wallet_id: null,
        hold_id: null,
        status: "completed",
        balance_before_minor: 0,
        balance_after_minor: 10000,
        created_at: 1700000000000,
      });

      expect(result!.next_cursor).toBeNull();
    });

    it("Given a getByWallet call, When the query is built, Then the WHERE requires a ledger entry for the wallet so pagination counts stay exact", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([]);

      await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      const where = transaction.findMany.mock.calls[0][0].where;
      const json = JSON.stringify(where);
      expect(json).toContain('"ledgerEntries":{"some":{"walletId":"wallet-1"}}');
    });

    it("Given a transaction with no ledger entry for the wallet, When getByWallet is called, Then it is excluded from the statement", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        buildMovementRow({ id: "txn-x", ledgerEntries: [] }),
        buildMovementRow(),
      ]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0]!.transaction_id).toBe("txn-1");
    });

    it("Given more entries than the limit, When getByWallet is called, Then it returns a next_cursor", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        buildMovementRow({ id: "txn-1", createdAt: 1700000000003n }),
        buildMovementRow({ id: "txn-2", createdAt: 1700000000002n }),
        buildMovementRow({ id: "txn-3", createdAt: 1700000000001n }),
      ]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 2 }));

      expect(result!.entries).toHaveLength(2);
      expect(result!.next_cursor).toBeTruthy();
    });

    it("Given hasMore is true but items is empty (limit 0 edge case), When getByWallet is called, Then next_cursor stays null", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildMovementRow()]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 0 }));

      expect(result!.entries).toEqual([]);
      expect(result!.next_cursor).toBeNull();
    });

    it("Given a free-text query, When getByWallet is called, Then it returns the matching entries", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildMovementRow()]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing(), "ref");

      expect(result!.entries).toHaveLength(1);
    });

    it("Given direction=credit, When getByWallet is called, Then the WHERE narrows the ledger entry to CREDIT", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([]);

      await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing(), undefined, "credit");

      const where = transaction.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain(
        '"ledgerEntries":{"some":{"walletId":"wallet-1","entryType":"CREDIT"}}',
      );
    });

    it("Given direction=debit, When getByWallet is called, Then the WHERE narrows the ledger entry to DEBIT", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([]);

      await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing(), undefined, "debit");

      const where = transaction.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain(
        '"ledgerEntries":{"some":{"walletId":"wallet-1","entryType":"DEBIT"}}',
      );
    });

    it("Given includeTotal, When getByWallet is called, Then it counts all matches (cursor-free) and returns the total", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildMovementRow()]);
      transaction.count.mockResolvedValue(42);

      const result = await store.getByWallet(
        ctx,
        "wallet-1",
        "platform-1",
        defaultListing({ cursor: undefined }),
        undefined,
        undefined,
        true,
      );

      expect(result!.total).toBe(42);
      expect(transaction.count).toHaveBeenCalledTimes(1);
    });

    it("Given a free-text query with LIKE wildcards, When getByWallet is called, Then they are escaped to match literally", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([]);

      await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing(), "a_b%c\\d");

      // Recursively find the `contains` value passed to Prisma.
      const findContains = (obj: unknown): string | undefined => {
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (k === "contains" && typeof v === "string") return v;
            const found = findContains(v);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };

      const where = transaction.findMany.mock.calls[0][0].where;
      expect(findContains(where)).toBe("a\\_b\\%c\\\\d");
    });
  });

  describe("getOne", () => {
    it("Given the wallet does not belong to the platform, When getOne is called, Then it returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getOne(ctx, "wallet-1", "mv-1", "wrong-platform");

      expect(result).toBeNull();
    });

    it("Given the movement exists for the wallet, When getOne is called, Then it returns the statement line", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findFirst.mockResolvedValue(buildMovementRow());

      const result = await store.getOne(ctx, "wallet-1", "mv-1", "platform-1");

      expect(result).not.toBeNull();
      expect(result!.movement_id).toBe("mv-1");
      expect(result!.direction).toBe("debit");
      expect(result!.balance_before_minor).toBe(10000);
      expect(result!.balance_after_minor).toBe(5000);
    });

    it("Given the movement does not exist for the wallet, When getOne is called, Then it returns null", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findFirst.mockResolvedValue(null);

      const result = await store.getOne(ctx, "wallet-1", "mv-404", "platform-1");

      expect(result).toBeNull();
    });
  });
});
