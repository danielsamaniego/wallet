import { describe, it, expect, vi } from "vitest";
import { PrismaWalletMovementReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/walletMovement.readstore.js";
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

// Cross-wallet search rows: ledger entries carry walletId (the include is not
// pre-filtered), and a deposit-style row has two entries on different wallets.
function buildSearchRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "txn-1",
    walletId: "wallet-1",
    counterpartWalletId: "sys-1",
    type: "deposit",
    amountMinor: 10000n,
    status: "completed",
    reference: "INV-1",
    metadata: { order_id: "o1" },
    holdId: null,
    movementId: "mv-1",
    createdAt: 1700000000000n,
    movement: { reason: null },
    ledgerEntries: [
      { walletId: "wallet-1", entryType: "CREDIT", amountMinor: 10000n, balanceAfterMinor: 10000n },
      { walletId: "sys-1", entryType: "DEBIT", amountMinor: -10000n, balanceAfterMinor: -10000n },
    ],
    ...overrides,
  };
}

describe("PrismaWalletMovementReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const transaction = { findMany: vi.fn(), findFirst: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const prisma = { transaction, wallet } as never;
    const logger = createMockLogger();
    const store = new PrismaWalletMovementReadStore(prisma, logger);
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
      expect(result!.movements).toHaveLength(2);

      expect(result!.movements[0]).toEqual({
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

      expect(result!.movements[1]).toEqual({
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

    it("Given a transaction with no ledger entry for the wallet, When getByWallet is called, Then it is excluded from the statement", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        buildMovementRow({ id: "txn-x", ledgerEntries: [] }),
        buildMovementRow(),
      ]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      expect(result!.movements).toHaveLength(1);
      expect(result!.movements[0]!.transaction_id).toBe("txn-1");
    });

    it("Given more movements than the limit, When getByWallet is called, Then it returns a next_cursor", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        buildMovementRow({ id: "txn-1", createdAt: 1700000000003n }),
        buildMovementRow({ id: "txn-2", createdAt: 1700000000002n }),
        buildMovementRow({ id: "txn-3", createdAt: 1700000000001n }),
      ]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 2 }));

      expect(result!.movements).toHaveLength(2);
      expect(result!.next_cursor).toBeTruthy();
    });

    it("Given hasMore is true but items is empty (limit 0 edge case), When getByWallet is called, Then next_cursor stays null", async () => {
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildMovementRow()]);

      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 0 }));

      expect(result!.movements).toEqual([]);
      expect(result!.next_cursor).toBeNull();
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

  describe("search", () => {
    const listing = defaultListing();

    it("Given a free-text query, When search is called, Then it picks the transaction's own-wallet entry and maps the DTO", async () => {
      const { store, transaction } = buildReadStore();
      transaction.findMany.mockResolvedValue([buildSearchRow()]);

      const result = await store.search(ctx, "platform-1", "INV", listing);

      expect(result.movements).toHaveLength(1);
      expect(result.movements[0]).toMatchObject({
        movement_id: "mv-1",
        transaction_id: "txn-1",
        type: "deposit",
        direction: "credit",
        amount_minor: 10000,
        balance_before_minor: 0,
        balance_after_minor: 10000,
      });
      expect(result.next_cursor).toBeNull();
    });

    it("Given no query, When search is called, Then it still returns platform-wide results", async () => {
      const { store, transaction } = buildReadStore();
      transaction.findMany.mockResolvedValue([buildSearchRow()]);

      const result = await store.search(ctx, "platform-1", undefined, listing);

      expect(result.movements).toHaveLength(1);
    });

    it("Given a transaction with no entry for its own wallet, When search is called, Then it is excluded", async () => {
      const { store, transaction } = buildReadStore();
      transaction.findMany.mockResolvedValue([
        buildSearchRow({
          ledgerEntries: [
            { walletId: "other", entryType: "CREDIT", amountMinor: 10000n, balanceAfterMinor: 10000n },
          ],
        }),
      ]);

      const result = await store.search(ctx, "platform-1", "INV", listing);

      expect(result.movements).toEqual([]);
    });

    it("Given more results than the limit, When search is called, Then it returns a next_cursor", async () => {
      const { store, transaction } = buildReadStore();
      transaction.findMany.mockResolvedValue([
        buildSearchRow({ id: "txn-1", createdAt: 1700000000003n }),
        buildSearchRow({ id: "txn-2", createdAt: 1700000000002n }),
        buildSearchRow({ id: "txn-3", createdAt: 1700000000001n }),
      ]);

      const result = await store.search(ctx, "platform-1", "INV", defaultListing({ limit: 2 }));

      expect(result.movements).toHaveLength(2);
      expect(result.next_cursor).toBeTruthy();
    });

    it("Given hasMore is true but items is empty (limit 0 edge case), When search is called, Then next_cursor stays null", async () => {
      const { store, transaction } = buildReadStore();
      transaction.findMany.mockResolvedValue([buildSearchRow()]);

      const result = await store.search(ctx, "platform-1", "INV", defaultListing({ limit: 0 }));

      expect(result.movements).toEqual([]);
      expect(result.next_cursor).toBeNull();
    });
  });
});
