import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaIdempotencyStore } from "@/common/idempotency/infrastructure/adapters/outbound/prisma/idempotency.store.js";
import { createTestContext } from "@test/helpers/builders/index.js";

function buildStore() {
  const idempotencyRecord = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const prisma = { idempotencyRecord } as any;
  const idGen = { newId: vi.fn().mockReturnValue("gen-id-1") };
  const store = new PrismaIdempotencyStore(prisma, idGen);
  return { store, prisma, idGen, idempotencyRecord };
}

describe("PrismaIdempotencyStore", () => {
  const ctx = createTestContext();

  // ── acquire ─────────────────────────────────────────────────────────

  describe("acquire", () => {
    it("Given no existing record, When acquire is called, Then inserts pending record and returns null (winner)", async () => {
      // Given
      const { store, idempotencyRecord, idGen } = buildStore();
      idempotencyRecord.findUnique.mockResolvedValue(null);
      idempotencyRecord.create.mockResolvedValue({});

      // When
      const result = await store.acquire(ctx, "key-1", "plat-1", "hash-abc", 1000, 2000);

      // Then
      expect(result).toBeNull();
      expect(idempotencyRecord.create).toHaveBeenCalledWith({
        data: {
          id: "gen-id-1",
          idempotencyKey: "key-1",
          platformId: "plat-1",
          requestHash: "hash-abc",
          responseStatus: 0,
          responseBody: {},
          createdAt: 1000n,
          expiresAt: 2000n,
        },
      });
    });

    it("Given an existing record, When acquire is called, Then returns the existing record without inserting", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      idempotencyRecord.findUnique.mockResolvedValue({
        idempotencyKey: "key-1",
        platformId: "plat-1",
        requestHash: "hash-abc",
        responseStatus: 201,
        responseBody: { id: "txn-1" },
        createdAt: 1000n,
        expiresAt: 2000n,
      });

      // When
      const result = await store.acquire(ctx, "key-1", "plat-1", "hash-abc", 1000, 2000);

      // Then
      expect(result).toEqual({
        idempotencyKey: "key-1",
        platformId: "plat-1",
        requestHash: "hash-abc",
        responseStatus: 201,
        responseBody: { id: "txn-1" },
        createdAt: 1000,
        expiresAt: 2000,
      });
      expect(idempotencyRecord.create).not.toHaveBeenCalled();
    });

    it("Given a race condition (unique constraint violation), When acquire catches error, Then re-fetches and returns existing", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      // First findUnique: no record
      idempotencyRecord.findUnique.mockResolvedValueOnce(null);
      // Create fails with unique constraint
      idempotencyRecord.create.mockRejectedValue(new Error("Unique constraint failed"));
      // Second findUnique: returns the record from the winner
      idempotencyRecord.findUnique.mockResolvedValueOnce({
        idempotencyKey: "key-1",
        platformId: "plat-1",
        requestHash: "hash-abc",
        responseStatus: 0,
        responseBody: {},
        createdAt: 1000n,
        expiresAt: 2000n,
      });

      // When
      const result = await store.acquire(ctx, "key-1", "plat-1", "hash-abc", 1000, 2000);

      // Then
      expect(result).toEqual({
        idempotencyKey: "key-1",
        platformId: "plat-1",
        requestHash: "hash-abc",
        responseStatus: 0,
        responseBody: {},
        createdAt: 1000,
        expiresAt: 2000,
      });
    });

    it("Given a race condition where re-fetch also returns null, When acquire catches error, Then re-throws original error", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      idempotencyRecord.findUnique.mockResolvedValue(null);
      const originalError = new Error("Unique constraint failed");
      idempotencyRecord.create.mockRejectedValue(originalError);

      // When / Then
      await expect(store.acquire(ctx, "key-1", "plat-1", "hash", 1000, 2000)).rejects.toBe(originalError);
    });
  });

  // ── complete ────────────────────────────────────────────────────────

  describe("complete", () => {
    it("Given a pending record, When complete is called, Then updates the record with response", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      idempotencyRecord.update.mockResolvedValue({});

      // When
      await store.complete(ctx, "key-1", "plat-1", 201, { id: "txn-1" });

      // Then
      expect(idempotencyRecord.update).toHaveBeenCalledWith({
        where: { idempotencyKey_platformId: { idempotencyKey: "key-1", platformId: "plat-1" } },
        data: {
          responseStatus: 201,
          responseBody: { id: "txn-1" },
        },
      });
    });
  });

  // ── release ─────────────────────────────────────────────────────────

  describe("release", () => {
    it("Given a pending record, When release is called, Then deletes the record", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      idempotencyRecord.delete.mockResolvedValue({});

      // When
      await store.release(ctx, "key-1", "plat-1");

      // Then
      expect(idempotencyRecord.delete).toHaveBeenCalledWith({
        where: { idempotencyKey_platformId: { idempotencyKey: "key-1", platformId: "plat-1" } },
      });
    });
  });

  // ── deleteExpired ───────────────────────────────────────────────────

  describe("deleteExpired", () => {
    it("Given expired records, When deleteExpired is called, Then deletes and returns count", async () => {
      // Given
      const { store, idempotencyRecord } = buildStore();
      idempotencyRecord.deleteMany.mockResolvedValue({ count: 5 });

      // When
      const result = await store.deleteExpired(ctx);

      // Then
      expect(result).toBe(5);
      expect(idempotencyRecord.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(BigInt) } },
      });
    });
  });
});
