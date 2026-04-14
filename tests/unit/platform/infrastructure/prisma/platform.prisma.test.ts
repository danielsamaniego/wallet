import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPlatformReadStore } from "@/platform/infrastructure/adapters/outbound/prisma/platform.readstore.js";
import { PrismaPlatformRepo } from "@/platform/infrastructure/adapters/outbound/prisma/platform.repo.js";
import { Platform } from "@/platform/domain/platform/platform.aggregate.js";
import { createTestContext } from "@test/helpers/builders/index.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import type { ListingQuery, SortField } from "@/utils/kernel/listing.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPlatformRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "plat-1",
    name: "Test Platform",
    apiKeyHash: "hash-abc",
    apiKeyId: "key-id-1",
    status: "active",
    createdAt: 1700000000000n,
    updatedAt: 1700000000000n,
    ...overrides,
  };
}

function defaultListing(overrides?: Partial<ListingQuery>): ListingQuery {
  return {
    filters: [],
    sort: [{ field: "createdAt", direction: "desc" }],
    limit: 20,
    ...overrides,
  };
}

// ── PrismaPlatformReadStore ──────────────────────────────────────────────────

describe("PrismaPlatformReadStore", () => {
  const ctx = createTestContext();

  function buildReadStore() {
    const platform = {
      findMany: vi.fn(),
    };
    const prisma = { platform } as any;
    const logger = createMockLogger();
    const store = new PrismaPlatformReadStore(prisma, logger);
    return { store, platform, logger };
  }

  describe("list", () => {
    it("Given platforms exist, When list is called, Then returns paginated DTOs", async () => {
      // Given
      const { store, platform } = buildReadStore();
      const rows = [
        buildPlatformRow({ id: "plat-1" }),
        buildPlatformRow({ id: "plat-2" }),
      ];
      platform.findMany.mockResolvedValue(rows);

      // When
      const result = await store.list(ctx, defaultListing({ limit: 20 }));

      // Then
      expect(result.platforms).toHaveLength(2);
      expect(result.platforms[0]).toEqual({
        id: "plat-1",
        name: "Test Platform",
        status: "active",
        created_at: 1700000000000,
        updated_at: 1700000000000,
      });
      expect(result.next_cursor).toBeNull();
    });

    it("Given more results than limit, When list is called, Then hasMore is true and nextCursor is set", async () => {
      // Given
      const { store, platform } = buildReadStore();
      // Return limit + 1 rows to trigger hasMore
      const rows = [
        buildPlatformRow({ id: "plat-1", createdAt: 1700000000003n }),
        buildPlatformRow({ id: "plat-2", createdAt: 1700000000002n }),
        buildPlatformRow({ id: "plat-3", createdAt: 1700000000001n }), // extra row
      ];
      platform.findMany.mockResolvedValue(rows);

      // When
      const result = await store.list(ctx, defaultListing({ limit: 2 }));

      // Then
      expect(result.platforms).toHaveLength(2);
      expect(result.next_cursor).toBeTruthy();
      expect(typeof result.next_cursor).toBe("string");
    });

    it("Given no platforms, When list is called, Then returns empty array", async () => {
      // Given
      const { store, platform } = buildReadStore();
      platform.findMany.mockResolvedValue([]);

      // When
      const result = await store.list(ctx, defaultListing());

      // Then
      expect(result.platforms).toEqual([]);
      expect(result.next_cursor).toBeNull();
    });

    it("Given hasMore is true but items is empty (edge case), When list is called, Then nextCursor remains null", async () => {
      // Given — findMany returns 1 row but limit is 0, so hasMore=true and items=[]
      const { store, platform } = buildReadStore();
      platform.findMany.mockResolvedValue([buildPlatformRow()]);

      // When
      const result = await store.list(ctx, defaultListing({ limit: 0 }));

      // Then
      expect(result.platforms).toEqual([]);
      expect(result.next_cursor).toBeNull();
    });
  });
});

// ── PrismaPlatformRepo ──────────────────────────────────────────────────────

describe("PrismaPlatformRepo", () => {
  const ctx = createTestContext();

  function buildRepo() {
    const platform = {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    };
    const prisma = { platform } as any;
    const logger = createMockLogger();
    const repo = new PrismaPlatformRepo(prisma, logger);
    return { repo, platform, logger };
  }

  describe("save", () => {
    it("Given a platform aggregate, When save is called, Then upserts to database", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.upsert.mockResolvedValue({});
      const platformAgg = Platform.create("plat-1", "Test", "hash-abc", "key-id-1", 1700000000000);

      // When
      await repo.save(ctx, platformAgg);

      // Then
      expect(platformModel.upsert).toHaveBeenCalledWith({
        where: { id: "plat-1" },
        create: expect.objectContaining({
          id: "plat-1",
          name: "Test",
          apiKeyHash: "hash-abc",
          apiKeyId: "key-id-1",
        }),
        update: expect.objectContaining({
          name: "Test",
          status: "active",
        }),
      });
    });
  });

  describe("save — uses opCtx when present", () => {
    it("Given a transactional context, When save is called, Then uses the transaction client", async () => {
      // Given
      const txPlatform = {
        upsert: vi.fn().mockResolvedValue({}),
      };
      const txClient = { platform: txPlatform } as any;
      const { repo } = buildRepo();
      const txCtx = createTestContext({ opCtx: txClient });
      const platformAgg = Platform.create("plat-1", "Test", "hash", "key-id", 1700000000000);

      // When
      await repo.save(txCtx, platformAgg);

      // Then
      expect(txPlatform.upsert).toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("Given a platform exists, When findById is called, Then returns domain aggregate", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.findUnique.mockResolvedValue(buildPlatformRow());

      // When
      const result = await repo.findById(ctx, "plat-1");

      // Then
      expect(result).not.toBeNull();
      expect(result!.id).toBe("plat-1");
      expect(result!.name).toBe("Test Platform");
      expect(result!.apiKeyHash).toBe("hash-abc");
      expect(result!.status).toBe("active");
    });

    it("Given no platform exists, When findById is called, Then returns null", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findById(ctx, "missing");

      // Then
      expect(result).toBeNull();
    });
  });

  describe("findByApiKeyId", () => {
    it("Given a platform with the api key id exists, When findByApiKeyId is called, Then returns domain aggregate", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.findUnique.mockResolvedValue(buildPlatformRow());

      // When
      const result = await repo.findByApiKeyId(ctx, "key-id-1");

      // Then
      expect(result).not.toBeNull();
      expect(result!.apiKeyId).toBe("key-id-1");
    });

    it("Given no platform with that api key id, When findByApiKeyId is called, Then returns null", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.findUnique.mockResolvedValue(null);

      // When
      const result = await repo.findByApiKeyId(ctx, "missing");

      // Then
      expect(result).toBeNull();
    });
  });

  describe("existsByApiKeyId", () => {
    it("Given a platform with the api key id exists, When existsByApiKeyId is called, Then returns true", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.count.mockResolvedValue(1);

      // When
      const result = await repo.existsByApiKeyId(ctx, "key-id-1");

      // Then
      expect(result).toBe(true);
    });

    it("Given no platform with that api key id, When existsByApiKeyId is called, Then returns false", async () => {
      // Given
      const { repo, platform: platformModel } = buildRepo();
      platformModel.count.mockResolvedValue(0);

      // When
      const result = await repo.existsByApiKeyId(ctx, "missing");

      // Then
      expect(result).toBe(false);
    });
  });
});
