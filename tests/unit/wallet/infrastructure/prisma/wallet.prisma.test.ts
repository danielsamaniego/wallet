import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaHoldReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/hold.readstore.js";
import { PrismaLedgerEntryReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/ledgerEntry.readstore.js";
import { PrismaTransactionReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/transaction.readstore.js";
import { PrismaHoldRepo } from "@/wallet/infrastructure/adapters/outbound/prisma/hold.repo.js";
import { PrismaWalletRepo } from "@/wallet/infrastructure/adapters/outbound/prisma/wallet.repo.js";
import { PrismaWalletReadStore } from "@/wallet/infrastructure/adapters/outbound/prisma/wallet.readstore.js";
import { PrismaLedgerEntryRepo } from "@/wallet/infrastructure/adapters/outbound/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "@/wallet/infrastructure/adapters/outbound/prisma/movement.repo.js";
import { PrismaTransactionRepo } from "@/wallet/infrastructure/adapters/outbound/prisma/transaction.repo.js";
import { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";
import { Hold } from "@/wallet/domain/hold/hold.entity.js";
import { LedgerEntry } from "@/wallet/domain/ledgerEntry/ledgerEntry.entity.js";
import { Movement } from "@/wallet/domain/movement/movement.entity.js";
import { Transaction } from "@/wallet/domain/transaction/transaction.entity.js";
import { AppError } from "@/utils/kernel/appError.js";
import { createTestContext } from "@test/helpers/builders/index.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";

// ── Shared helpers ───────────────────────────────────────────────────────────

function defaultListing(overrides?: Partial<ListingQuery>): ListingQuery {
  return {
    filters: [],
    sort: [{ field: "createdAt", direction: "desc" as const }],
    limit: 20,
    ...overrides,
  };
}

function buildHoldRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "hold-1",
    walletId: "wallet-1",
    amountCents: 5000n,
    status: "active",
    reference: "ref-1",
    expiresAt: 1700100000000n,
    createdAt: 1700000000000n,
    updatedAt: 1700000000000n,
    ...overrides,
  };
}

function buildLedgerRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "le-1",
    transactionId: "txn-1",
    walletId: "wallet-1",
    entryType: "credit",
    amountCents: 10000n,
    balanceAfterCents: 10000n,
    createdAt: 1700000000000n,
    ...overrides,
  };
}

function buildTransactionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "txn-1",
    walletId: "wallet-1",
    counterpartWalletId: null,
    type: "deposit",
    amountCents: 10000n,
    status: "completed",
    idempotencyKey: "idem-1",
    reference: "ref-1",
    metadata: { source: "test" },
    holdId: null,
    createdAt: 1700000000000n,
    ...overrides,
  };
}

function buildWalletRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "wallet-1",
    ownerId: "owner-1",
    platformId: "platform-1",
    currencyCode: "USD",
    cachedBalanceCents: 10000n,
    status: "active",
    version: 1,
    isSystem: false,
    createdAt: 1700000000000n,
    updatedAt: 1700000000000n,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PrismaHoldReadStore
// ═════════════════════════════════════════════════════════════════════════════

describe("PrismaHoldReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const hold = { findFirst: vi.fn(), findMany: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const prisma = { hold, wallet } as any;
    const logger = createMockLogger();
    const store = new PrismaHoldReadStore(prisma, logger);
    return { store, hold, wallet, logger };
  }

  describe("getById", () => {
    it("Given hold exists and belongs to platform, When getById is called, Then returns DTO", async () => {
      // Given
      const { store, hold } = buildReadStore();
      hold.findFirst.mockResolvedValue({
        ...buildHoldRow(),
        wallet: { platformId: "platform-1" },
      });

      // When
      const result = await store.getById(ctx, "hold-1", "platform-1");

      // Then
      expect(result).not.toBeNull();
      expect(result!.id).toBe("hold-1");
      expect(result!.wallet_id).toBe("wallet-1");
      expect(result!.amount_cents).toBe(5000);
      expect(result!.status).toBe("active");
      expect(result!.reference).toBe("ref-1");
      expect(result!.expires_at).toBe(1700100000000);
      expect(result!.created_at).toBe(1700000000000);
    });

    it("Given hold does not exist, When getById is called, Then returns null", async () => {
      // Given
      const { store, hold } = buildReadStore();
      hold.findFirst.mockResolvedValue(null);

      // When
      const result = await store.getById(ctx, "missing", "platform-1");

      // Then
      expect(result).toBeNull();
    });

    it("Given hold exists but belongs to a different platform, When getById is called, Then returns null", async () => {
      // Given
      const { store, hold } = buildReadStore();
      hold.findFirst.mockResolvedValue({
        ...buildHoldRow(),
        wallet: { platformId: "other-platform" },
      });

      // When
      const result = await store.getById(ctx, "hold-1", "platform-1");

      // Then
      expect(result).toBeNull();
    });

    it("Given hold with null expiresAt, When getById is called, Then expires_at is null in DTO", async () => {
      // Given
      const { store, hold } = buildReadStore();
      hold.findFirst.mockResolvedValue({
        ...buildHoldRow({ expiresAt: null }),
        wallet: { platformId: "platform-1" },
      });

      // When
      const result = await store.getById(ctx, "hold-1", "platform-1");

      // Then
      expect(result!.expires_at).toBeNull();
    });
  });

  describe("getByWallet", () => {
    it("Given wallet belongs to platform and has holds, When getByWallet is called, Then returns paginated holds", async () => {
      // Given
      const { store, hold, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      hold.findMany.mockResolvedValue([buildHoldRow({ id: "hold-1" }), buildHoldRow({ id: "hold-2" })]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      // Then
      expect(result).not.toBeNull();
      expect(result!.holds).toHaveLength(2);
      expect(result!.next_cursor).toBeNull();
    });

    it("Given wallet does not belong to platform, When getByWallet is called, Then returns null", async () => {
      // Given
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "wrong-platform", defaultListing());

      // Then
      expect(result).toBeNull();
    });

    it("Given more holds than limit, When getByWallet is called, Then returns cursor for next page", async () => {
      // Given
      const { store, hold, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      hold.findMany.mockResolvedValue([
        buildHoldRow({ id: "h-1", createdAt: 1700000000003n }),
        buildHoldRow({ id: "h-2", createdAt: 1700000000002n }),
        buildHoldRow({ id: "h-3", createdAt: 1700000000001n }),
      ]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 2 }));

      // Then
      expect(result!.holds).toHaveLength(2);
      expect(result!.next_cursor).toBeTruthy();
    });

    it("Given hasMore is true but items is empty (edge case), When getByWallet is called, Then nextCursor remains null", async () => {
      // Given — findMany returns 1 row but limit is 0, so hasMore=true and items=[]
      const { store, hold, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      hold.findMany.mockResolvedValue([buildHoldRow()]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 0 }));

      // Then
      expect(result!.holds).toEqual([]);
      expect(result!.next_cursor).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PrismaLedgerEntryReadStore
// ═════════════════════════════════════════════════════════════════════════════

describe("PrismaLedgerEntryReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const ledgerEntry = { findMany: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const prisma = { ledgerEntry, wallet } as any;
    const logger = createMockLogger();
    const store = new PrismaLedgerEntryReadStore(prisma, logger);
    return { store, ledgerEntry, wallet, logger };
  }

  describe("getByWallet", () => {
    it("Given wallet belongs to platform and has entries, When getByWallet is called, Then returns paginated entries", async () => {
      // Given
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.findMany.mockResolvedValue([buildLedgerRow(), buildLedgerRow({ id: "le-2" })]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      // Then
      expect(result).not.toBeNull();
      expect(result!.ledger_entries).toHaveLength(2);
      expect(result!.ledger_entries[0]).toEqual({
        id: "le-1",
        transaction_id: "txn-1",
        wallet_id: "wallet-1",
        entry_type: "credit",
        amount_cents: 10000,
        balance_after_cents: 10000,
        created_at: 1700000000000,
      });
      expect(result!.next_cursor).toBeNull();
    });

    it("Given wallet does not belong to platform, When getByWallet is called, Then returns null", async () => {
      // Given
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "wrong-platform", defaultListing());

      // Then
      expect(result).toBeNull();
    });

    it("Given more entries than limit, When getByWallet is called, Then returns next_cursor", async () => {
      // Given
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.findMany.mockResolvedValue([
        buildLedgerRow({ id: "le-1", createdAt: 1700000000003n }),
        buildLedgerRow({ id: "le-2", createdAt: 1700000000002n }),
        buildLedgerRow({ id: "le-3", createdAt: 1700000000001n }),
      ]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 2 }));

      // Then
      expect(result!.ledger_entries).toHaveLength(2);
      expect(result!.next_cursor).toBeTruthy();
    });

    it("Given hasMore is true but items is empty (edge case), When getByWallet is called, Then nextCursor remains null", async () => {
      // Given — findMany returns 1 row but limit is 0, so hasMore=true and items=[]
      const { store, ledgerEntry, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      ledgerEntry.findMany.mockResolvedValue([buildLedgerRow()]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 0 }));

      // Then
      expect(result!.ledger_entries).toEqual([]);
      expect(result!.next_cursor).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PrismaTransactionReadStore
// ═════════════════════════════════════════════════════════════════════════════

describe("PrismaTransactionReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const transaction = { findMany: vi.fn() };
    const wallet = { findFirst: vi.fn() };
    const prisma = { transaction, wallet } as any;
    const logger = createMockLogger();
    const store = new PrismaTransactionReadStore(prisma, logger);
    return { store, transaction, wallet, logger };
  }

  describe("getByWallet", () => {
    it("Given wallet belongs to platform and has transactions, When getByWallet is called, Then returns paginated DTOs", async () => {
      // Given
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildTransactionRow()]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      // Then
      expect(result).not.toBeNull();
      expect(result!.transactions).toHaveLength(1);
      expect(result!.transactions[0]).toEqual({
        id: "txn-1",
        wallet_id: "wallet-1",
        counterpart_wallet_id: null,
        type: "deposit",
        amount_cents: 10000,
        status: "completed",
        idempotency_key: "idem-1",
        reference: "ref-1",
        metadata: { source: "test" },
        hold_id: null,
        created_at: 1700000000000,
      });
      expect(result!.next_cursor).toBeNull();
    });

    it("Given wallet does not belong to platform, When getByWallet is called, Then returns null", async () => {
      // Given
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "wrong-platform", defaultListing());

      // Then
      expect(result).toBeNull();
    });

    it("Given more transactions than limit, When getByWallet is called, Then returns next_cursor", async () => {
      // Given
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([
        buildTransactionRow({ id: "txn-1", createdAt: 1700000000003n }),
        buildTransactionRow({ id: "txn-2", createdAt: 1700000000002n }),
        buildTransactionRow({ id: "txn-3", createdAt: 1700000000001n }),
      ]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 2 }));

      // Then
      expect(result!.transactions).toHaveLength(2);
      expect(result!.next_cursor).toBeTruthy();
    });

    it("Given transaction with null metadata, When getByWallet is called, Then metadata is null in DTO", async () => {
      // Given
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildTransactionRow({ metadata: null })]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing());

      // Then
      expect(result!.transactions[0]!.metadata).toBeNull();
    });

    it("Given hasMore is true but items is empty (edge case), When getByWallet is called, Then nextCursor remains null", async () => {
      // Given — findMany returns 1 row but limit is 0, so hasMore=true and items=[]
      const { store, transaction, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue({ id: "wallet-1" });
      transaction.findMany.mockResolvedValue([buildTransactionRow()]);

      // When
      const result = await store.getByWallet(ctx, "wallet-1", "platform-1", defaultListing({ limit: 0 }));

      // Then
      expect(result!.transactions).toEqual([]);
      expect(result!.next_cursor).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PrismaHoldRepo
// ═════════════════════════════════════════════════════════════════════════════

describe("PrismaHoldRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const hold = {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    };
    const prisma = { hold } as any;
    const logger = createMockLogger();
    const repo = new PrismaHoldRepo(prisma, logger);
    return { repo, hold, logger };
  }

  describe("save", () => {
    it("Given a hold entity, When save is called, Then upserts to database", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.upsert.mockResolvedValue({});
      const holdEntity = Hold.reconstruct({
        id: "hold-1",
        walletId: "wallet-1",
        amountCents: 5000n,
        status: "active",
        reference: "ref-1",
        expiresAt: 1700100000000,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      });

      // When
      await repo.save(ctx, holdEntity);

      // Then
      expect(holdModel.upsert).toHaveBeenCalledWith({
        where: { id: "hold-1" },
        create: expect.objectContaining({
          id: "hold-1",
          walletId: "wallet-1",
          amountCents: 5000n,
          status: "active",
          reference: "ref-1",
          expiresAt: 1700100000000n,
        }),
        update: { status: "active", updatedAt: 1700000000000n },
      });
    });

    it("Given a hold with null expiresAt, When save is called, Then persists null expiresAt", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.upsert.mockResolvedValue({});
      const holdEntity = Hold.reconstruct({
        id: "hold-1",
        walletId: "wallet-1",
        amountCents: 5000n,
        status: "active",
        reference: null,
        expiresAt: null,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      });

      // When
      await repo.save(ctx, holdEntity);

      // Then
      const createArg = holdModel.upsert.mock.calls[0]![0].create;
      expect(createArg.expiresAt).toBeNull();
    });
  });

  describe("findById", () => {
    it("Given a hold exists, When findById is called, Then returns domain entity", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.findUnique.mockResolvedValue(buildHoldRow());

      // When
      const result = await repo.findById(ctx, "hold-1");

      // Then
      expect(result).not.toBeNull();
      expect(result!.id).toBe("hold-1");
      expect(result!.walletId).toBe("wallet-1");
      expect(result!.amountCents).toBe(5000n);
      expect(result!.status).toBe("active");
    });

    it("Given no hold exists, When findById is called, Then returns null", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findById(ctx, "missing");

      // Then
      expect(result).toBeNull();
    });

    it("Given hold with null expiresAt, When findById is called, Then expiresAt is null in domain entity", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.findUnique.mockResolvedValue(buildHoldRow({ expiresAt: null }));

      // When
      const result = await repo.findById(ctx, "hold-1");

      // Then
      expect(result!.expiresAt).toBeNull();
    });
  });

  describe("findActiveByWallet", () => {
    it("Given active holds exist, When findActiveByWallet is called, Then returns domain entities", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.findMany.mockResolvedValue([buildHoldRow({ id: "h-1" }), buildHoldRow({ id: "h-2" })]);

      // When
      const result = await repo.findActiveByWallet(ctx, "wallet-1");

      // Then
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("h-1");
    });
  });

  describe("sumActiveHolds", () => {
    it("Given active holds exist, When sumActiveHolds is called, Then returns sum of amountCents", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.aggregate.mockResolvedValue({ _sum: { amountCents: 15000n } });

      // When
      const result = await repo.sumActiveHolds(ctx, "wallet-1");

      // Then
      expect(result).toBe(15000n);
    });

    it("Given no active holds, When sumActiveHolds is called, Then returns 0n", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.aggregate.mockResolvedValue({ _sum: { amountCents: null } });

      // When
      const result = await repo.sumActiveHolds(ctx, "wallet-1");

      // Then
      expect(result).toBe(0n);
    });
  });

  describe("countActiveHolds", () => {
    it("Given active holds exist, When countActiveHolds is called, Then returns count", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.count.mockResolvedValue(3);

      // When
      const result = await repo.countActiveHolds(ctx, "wallet-1");

      // Then
      expect(result).toBe(3);
    });
  });

  describe("expireOverdue", () => {
    it("Given overdue holds exist, When expireOverdue is called, Then updates and returns count", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.updateMany.mockResolvedValue({ count: 2 });

      // When
      const result = await repo.expireOverdue(ctx);

      // Then
      expect(result).toBe(2);
      expect(holdModel.updateMany).toHaveBeenCalledWith({
        where: {
          status: "active",
          expiresAt: { not: null, lt: expect.any(BigInt) },
        },
        data: {
          status: "expired",
          updatedAt: expect.any(BigInt),
        },
      });
    });
  });

  describe("transitionStatus", () => {
    it("Given the hold matches fromStatus, When transitionStatus is called, Then updates successfully", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.updateMany.mockResolvedValue({ count: 1 });
      const now = 1700000000000;

      // When
      await repo.transitionStatus(ctx, "hold-1", "active", "captured", now);

      // Then
      expect(holdModel.updateMany).toHaveBeenCalledWith({
        where: { id: "hold-1", status: "active" },
        data: { status: "captured", updatedAt: BigInt(now) },
      });
    });

    it("Given the hold was already changed, When transitionStatus is called, Then throws HOLD_STATUS_CHANGED", async () => {
      // Given
      const { repo, hold: holdModel } = buildRepo();
      holdModel.updateMany.mockResolvedValue({ count: 0 });

      // When/Then
      await expect(
        repo.transitionStatus(ctx, "hold-1", "active", "voided", 1700000000000),
      ).rejects.toThrow(AppError);

      await expect(
        repo.transitionStatus(ctx, "hold-1", "active", "voided", 1700000000000),
      ).rejects.toThrow(/status changed concurrently/i);
    });
  });

  describe("client — uses opCtx when present", () => {
    it("Given a transactional context, When findById is called, Then uses the transaction client", async () => {
      // Given
      const txHold = { findUnique: vi.fn().mockResolvedValue(null) };
      const txClient = { hold: txHold } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      // When
      await repo.findById(txCtx, "hold-1");

      // Then
      expect(txHold.findUnique).toHaveBeenCalled();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PrismaWalletRepo
// ═════════════════════════════════════════════════════════════════════════════

describe("PrismaWalletRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const walletModel = {
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    };
    const prisma = { wallet: walletModel } as any;
    const logger = createMockLogger();
    const repo = new PrismaWalletRepo(prisma, logger);
    return { repo, walletModel, logger };
  }

  describe("save — new wallet (version 1)", () => {
    it("Given a new wallet with version 1, When save is called, Then creates in database", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.create.mockResolvedValue({});
      const wallet = Wallet.create("w-1", "owner-1", "platform-1", "USD", false, 1700000000000);

      // When
      await repo.save(ctx, wallet);

      // Then
      expect(walletModel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "w-1",
          ownerId: "owner-1",
          platformId: "platform-1",
          currencyCode: "USD",
          cachedBalanceCents: 0n,
          status: "active",
          version: 1,
          isSystem: false,
        }),
      });
    });
  });

  describe("save — existing wallet (version > 1)", () => {
    it("Given an existing wallet with version > 1, When save is called with matching version, Then updates", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.updateMany.mockResolvedValue({ count: 1 });
      const wallet = Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", 5000n, "active", 2, false, 1700000000000, 1700000000000);

      // When
      await repo.save(ctx, wallet);

      // Then
      expect(walletModel.updateMany).toHaveBeenCalledWith({
        where: { id: "w-1", version: 1 },
        data: expect.objectContaining({
          cachedBalanceCents: 5000n,
          status: "active",
          version: 2,
        }),
      });
    });

    it("Given a version conflict, When save is called and no rows updated, Then throws VERSION_CONFLICT", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.updateMany.mockResolvedValue({ count: 0 });
      const wallet = Wallet.reconstruct("w-1", "owner-1", "platform-1", "USD", 5000n, "active", 3, false, 1700000000000, 1700000000000);

      // When / Then
      await expect(repo.save(ctx, wallet)).rejects.toSatisfy((err: unknown) => {
        return AppError.is(err) && err.code === "VERSION_CONFLICT";
      });
    });
  });

  describe("adjustSystemWalletBalance", () => {
    it("Given a system wallet, When adjustSystemWalletBalance is called, Then increments balance", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.update.mockResolvedValue({});

      // When
      await repo.adjustSystemWalletBalance(ctx, "sys-wallet", 5000n, 1700000000000);

      // Then
      expect(walletModel.update).toHaveBeenCalledWith({
        where: { id: "sys-wallet" },
        data: {
          cachedBalanceCents: { increment: 5000n },
          updatedAt: 1700000000000n,
        },
      });
    });
  });

  describe("findById", () => {
    it("Given a wallet exists, When findById is called, Then returns domain aggregate", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(buildWalletRow());

      // When
      const result = await repo.findById(ctx, "wallet-1");

      // Then
      expect(result).not.toBeNull();
      expect(result!.id).toBe("wallet-1");
      expect(result!.ownerId).toBe("owner-1");
      expect(result!.platformId).toBe("platform-1");
      expect(result!.currencyCode).toBe("USD");
      expect(result!.cachedBalanceCents).toBe(10000n);
      expect(result!.status).toBe("active");
    });

    it("Given no wallet exists, When findById is called, Then returns null", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findById(ctx, "missing");

      // Then
      expect(result).toBeNull();
    });
  });

  describe("findByOwner", () => {
    it("Given a wallet exists for owner, When findByOwner is called, Then returns domain aggregate", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(buildWalletRow());

      // When
      const result = await repo.findByOwner(ctx, "owner-1", "platform-1", "USD");

      // Then
      expect(result).not.toBeNull();
      expect(result!.ownerId).toBe("owner-1");
      expect(walletModel.findUnique).toHaveBeenCalledWith({
        where: {
          ownerId_platformId_currencyCode: {
            ownerId: "owner-1",
            platformId: "platform-1",
            currencyCode: "USD",
          },
        },
      });
    });

    it("Given no wallet for owner, When findByOwner is called, Then returns null", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findByOwner(ctx, "owner-x", "platform-1", "USD");

      // Then
      expect(result).toBeNull();
    });

    it("Given lowercase currency code, When findByOwner is called, Then uppercases it", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(null);

      // When
      await repo.findByOwner(ctx, "owner-1", "platform-1", "usd");

      // Then
      expect(walletModel.findUnique).toHaveBeenCalledWith({
        where: {
          ownerId_platformId_currencyCode: {
            ownerId: "owner-1",
            platformId: "platform-1",
            currencyCode: "USD",
          },
        },
      });
    });
  });

  describe("findSystemWallet", () => {
    it("Given a system wallet exists, When findSystemWallet is called, Then returns domain aggregate", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(buildWalletRow({ ownerId: "SYSTEM", isSystem: true }));

      // When
      const result = await repo.findSystemWallet(ctx, "platform-1", "USD");

      // Then
      expect(result).not.toBeNull();
      expect(result!.ownerId).toBe("SYSTEM");
      expect(result!.isSystem).toBe(true);
    });

    it("Given no system wallet, When findSystemWallet is called, Then returns null", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findSystemWallet(ctx, "platform-1", "USD");

      // Then
      expect(result).toBeNull();
    });

    it("Given lowercase currency code, When findSystemWallet is called, Then uppercases it", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.findUnique.mockResolvedValue(null);

      // When
      await repo.findSystemWallet(ctx, "platform-1", "eur");

      // Then
      expect(walletModel.findUnique).toHaveBeenCalledWith({
        where: {
          ownerId_platformId_currencyCode: {
            ownerId: "SYSTEM",
            platformId: "platform-1",
            currencyCode: "EUR",
          },
        },
      });
    });
  });

  describe("existsByOwner", () => {
    it("Given a wallet exists for owner, When existsByOwner is called, Then returns true", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.count.mockResolvedValue(1);

      // When
      const result = await repo.existsByOwner(ctx, "owner-1", "platform-1", "USD");

      // Then
      expect(result).toBe(true);
    });

    it("Given no wallet for owner, When existsByOwner is called, Then returns false", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.count.mockResolvedValue(0);

      // When
      const result = await repo.existsByOwner(ctx, "owner-x", "platform-1", "USD");

      // Then
      expect(result).toBe(false);
    });

    it("Given lowercase currency code, When existsByOwner is called, Then uppercases it", async () => {
      // Given
      const { repo, walletModel } = buildRepo();
      walletModel.count.mockResolvedValue(0);

      // When
      await repo.existsByOwner(ctx, "owner-1", "platform-1", "usd");

      // Then
      expect(walletModel.count).toHaveBeenCalledWith({
        where: { ownerId: "owner-1", platformId: "platform-1", currencyCode: "USD" },
      });
    });
  });

  describe("client — uses opCtx when present", () => {
    it("Given a transactional context, When findById is called, Then uses the transaction client", async () => {
      // Given
      const txWallet = { findUnique: vi.fn().mockResolvedValue(null) };
      const txClient = { wallet: txWallet } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      // When
      await repo.findById(txCtx, "wallet-1");

      // Then
      expect(txWallet.findUnique).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// PrismaLedgerEntryRepo
// =============================================================================

describe("PrismaLedgerEntryRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const ledgerEntry = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const prisma = { ledgerEntry } as any;
    const logger = createMockLogger();
    const repo = new PrismaLedgerEntryRepo(prisma, logger);
    return { repo, ledgerEntry, logger };
  }

  describe("client — uses opCtx when present", () => {
    it("Given a transactional context, When saveMany is called, Then uses the transaction client", async () => {
      const txLedgerEntry = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
      const txClient = { ledgerEntry: txLedgerEntry } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      const entry = LedgerEntry.create({
        id: "le-1",
        transactionId: "txn-1",
        walletId: "wallet-1",
        entryType: "CREDIT",
        amountCents: 1000n,
        balanceAfterCents: 1000n,
        movementId: "mov-1",
        createdAt: 1700000000000,
      });

      await repo.saveMany(txCtx, [entry]);

      expect(txLedgerEntry.createMany).toHaveBeenCalled();
    });
  });

  describe("client — falls back to prisma when opCtx is undefined", () => {
    it("Given a context without opCtx, When saveMany is called, Then uses the default prisma client", async () => {
      const { repo, ledgerEntry } = buildRepo();

      const entry = LedgerEntry.create({
        id: "le-1",
        transactionId: "txn-1",
        walletId: "wallet-1",
        entryType: "CREDIT",
        amountCents: 1000n,
        balanceAfterCents: 1000n,
        movementId: "mov-1",
        createdAt: 1700000000000,
      });

      await repo.saveMany(ctx, [entry]);

      expect(ledgerEntry.createMany).toHaveBeenCalled();
    });
  });

  describe("saveMany — empty array", () => {
    it("Given an empty entries array, When saveMany is called, Then returns early without calling createMany", async () => {
      const { repo, ledgerEntry } = buildRepo();

      await repo.saveMany(ctx, []);

      expect(ledgerEntry.createMany).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// PrismaMovementRepo
// =============================================================================

describe("PrismaMovementRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const movement = { create: vi.fn().mockResolvedValue({}) };
    const prisma = { movement } as any;
    const logger = createMockLogger();
    const repo = new PrismaMovementRepo(prisma, logger);
    return { repo, movement, logger };
  }

  describe("client — uses opCtx when present", () => {
    it("Given a transactional context, When save is called, Then uses the transaction client", async () => {
      const txMovement = { create: vi.fn().mockResolvedValue({}) };
      const txClient = { movement: txMovement } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      const mov = Movement.create({ id: "mov-1", type: "transfer", createdAt: 1700000000000 });

      await repo.save(txCtx, mov);

      expect(txMovement.create).toHaveBeenCalled();
    });
  });

  describe("client — falls back to prisma when opCtx is undefined", () => {
    it("Given a context without opCtx, When save is called, Then uses the default prisma client", async () => {
      const { repo, movement } = buildRepo();

      const mov = Movement.create({ id: "mov-1", type: "transfer", createdAt: 1700000000000 });

      await repo.save(ctx, mov);

      expect(movement.create).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// PrismaTransactionRepo
// =============================================================================

describe("PrismaTransactionRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const transaction = {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { transaction } as any;
    const logger = createMockLogger();
    const repo = new PrismaTransactionRepo(prisma, logger);
    return { repo, transaction, logger };
  }

  describe("client — uses opCtx when present", () => {
    it("Given a transactional context, When save is called, Then uses the transaction client", async () => {
      const txTransaction = { create: vi.fn().mockResolvedValue({}) };
      const txClient = { transaction: txTransaction } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      const tx = Transaction.create({
        id: "txn-1",
        walletId: "wallet-1",
        counterpartWalletId: null,
        type: "deposit",
        amountCents: 5000n,
        status: "completed",
        idempotencyKey: "idem-1",
        reference: null,
        metadata: null,
        holdId: null,
        movementId: "mov-1",
        createdAt: 1700000000000,
      });

      await repo.save(txCtx, tx);

      expect(txTransaction.create).toHaveBeenCalled();
    });
  });

  describe("client — falls back to prisma when opCtx is undefined", () => {
    it("Given a context without opCtx, When save is called, Then uses the default prisma client", async () => {
      const { repo, transaction } = buildRepo();

      const tx = Transaction.create({
        id: "txn-1",
        walletId: "wallet-1",
        counterpartWalletId: null,
        type: "deposit",
        amountCents: 5000n,
        status: "completed",
        idempotencyKey: "idem-1",
        reference: null,
        metadata: null,
        holdId: null,
        movementId: "mov-1",
        createdAt: 1700000000000,
      });

      await repo.save(ctx, tx);

      expect(transaction.create).toHaveBeenCalled();
    });
  });

  describe("saveMany", () => {
    it("Given an empty array, When saveMany is called, Then it returns early without calling createMany", async () => {
      const { repo, transaction } = buildRepo();

      await repo.saveMany(ctx, []);

      expect(transaction.createMany).not.toHaveBeenCalled();
    });

    it("Given a transactional context, When saveMany is called, Then uses the transaction client", async () => {
      const txTransaction = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
      const txClient = { transaction: txTransaction } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });

      const tx = Transaction.create({
        id: "txn-1",
        walletId: "wallet-1",
        counterpartWalletId: "wallet-2",
        type: "transfer_out",
        amountCents: 5000n,
        status: "completed",
        idempotencyKey: "idem-1",
        reference: "ref",
        metadata: { key: "val" },
        holdId: null,
        movementId: "mov-1",
        createdAt: 1700000000000,
      });

      await repo.saveMany(txCtx, [tx]);

      expect(txTransaction.createMany).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// PrismaWalletReadStore
// =============================================================================

describe("PrismaWalletReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const wallet = { findFirst: vi.fn() };
    const hold = { aggregate: vi.fn() };
    const prisma = { wallet, hold } as any;
    const logger = createMockLogger();
    const store = new PrismaWalletReadStore(prisma, logger);
    return { store, wallet, hold, logger };
  }

  describe("getById — available balance clamped to zero", () => {
    it("Given active holds exceed cached balance, When getById is called, Then available_balance_cents is 0", async () => {
      const { store, wallet, hold } = buildReadStore();

      wallet.findFirst.mockResolvedValue({
        id: "wallet-1",
        ownerId: "owner-1",
        platformId: "platform-1",
        currencyCode: "USD",
        cachedBalanceCents: 5000n,
        status: "active",
        isSystem: false,
        createdAt: 1700000000000n,
        updatedAt: 1700000000000n,
      });

      // Active holds exceed balance: 8000 > 5000
      hold.aggregate.mockResolvedValue({ _sum: { amountCents: 8000n } });

      const result = await store.getById(ctx, "wallet-1", "platform-1");

      expect(result).not.toBeNull();
      expect(result!.available_balance_cents).toBe(0);
      expect(result!.balance_cents).toBe(5000);
    });
  });

  describe("getById — wallet not found", () => {
    it("Given wallet does not exist, When getById is called, Then returns null", async () => {
      const { store, wallet } = buildReadStore();
      wallet.findFirst.mockResolvedValue(null);

      const result = await store.getById(ctx, "missing", "platform-1");

      expect(result).toBeNull();
    });
  });

  describe("getById — positive available balance", () => {
    it("Given active holds are less than cached balance, When getById is called, Then available_balance_cents is positive", async () => {
      const { store, wallet, hold } = buildReadStore();

      wallet.findFirst.mockResolvedValue({
        id: "wallet-1",
        ownerId: "owner-1",
        platformId: "platform-1",
        currencyCode: "USD",
        cachedBalanceCents: 10000n,
        status: "active",
        isSystem: false,
        createdAt: 1700000000000n,
        updatedAt: 1700000000000n,
      });

      hold.aggregate.mockResolvedValue({ _sum: { amountCents: 3000n } });

      const result = await store.getById(ctx, "wallet-1", "platform-1");

      expect(result).not.toBeNull();
      expect(result!.available_balance_cents).toBe(7000);
    });
  });

  describe("getById — no active holds (null sum)", () => {
    it("Given no active holds exist (aggregate returns null), When getById is called, Then available_balance_cents equals balance_cents", async () => {
      const { store, wallet, hold } = buildReadStore();

      wallet.findFirst.mockResolvedValue({
        id: "wallet-1",
        ownerId: "owner-1",
        platformId: "platform-1",
        currencyCode: "USD",
        cachedBalanceCents: 5000n,
        status: "active",
        isSystem: false,
        createdAt: 1700000000000n,
        updatedAt: 1700000000000n,
      });

      // aggregate returns null when there are no matching holds
      hold.aggregate.mockResolvedValue({ _sum: { amountCents: null } });

      const result = await store.getById(ctx, "wallet-1", "platform-1");

      expect(result).not.toBeNull();
      expect(result!.balance_cents).toBe(5000);
      expect(result!.available_balance_cents).toBe(5000);
    });
  });
});
