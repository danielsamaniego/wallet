import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetPlatformMovementBreakdownUseCase } from "@/wallet/application/query/getPlatformMovementBreakdown/usecase.js";
import { GetPlatformMovementBreakdownQuery } from "@/wallet/application/query/getPlatformMovementBreakdown/query.js";
import type {
  IWalletAnalyticsReadStore,
  MovementBreakdownBucketDTO,
} from "@/wallet/application/ports/walletAnalytics.readstore.js";

const FROM = 1_700_000_000_000;
const TO = 1_700_100_000_000;

describe("GetPlatformMovementBreakdownUseCase", () => {
  const readStore = mock<IWalletAnalyticsReadStore>();
  const logger = createMockLogger();
  const useCase = new GetPlatformMovementBreakdownUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the platform has movements in range", () => {
    const buckets: MovementBreakdownBucketDTO[] = [
      { bucket: "owner-1", sum_net_minor: 5000, sum_credits_minor: 8000, sum_debits_minor: -3000, count: 9 },
    ];

    beforeEach(() => {
      readStore.aggregateMovements.mockResolvedValue(buckets);
    });

    it("Then it returns the buckets and delegates with the platform scope", async () => {
      const result = await useCase.handle(
        ctx,
        new GetPlatformMovementBreakdownQuery("p1", FROM, TO, "owner", "all"),
      );

      expect(result).toEqual(buckets);
      expect(readStore.aggregateMovements).toHaveBeenCalledWith(ctx, {
        platformId: "p1",
        fromMs: FROM,
        toMs: TO,
        groupBy: "owner",
        direction: "all",
        metadataKey: undefined,
        ownerId: undefined,
      });
    });

    it("Then it forwards metadataKey and ownerId when provided", async () => {
      await useCase.handle(
        ctx,
        new GetPlatformMovementBreakdownQuery("p1", FROM, TO, "metadata", "debit", "reasonKey", "owner-7"),
      );

      expect(readStore.aggregateMovements).toHaveBeenCalledWith(ctx, {
        platformId: "p1",
        fromMs: FROM,
        toMs: TO,
        groupBy: "metadata",
        direction: "debit",
        metadataKey: "reasonKey",
        ownerId: "owner-7",
      });
    });
  });

  describe("Given the read store returns null (no scope match)", () => {
    beforeEach(() => {
      readStore.aggregateMovements.mockResolvedValue(null);
    });

    it("Then it returns an empty array", async () => {
      const result = await useCase.handle(
        ctx,
        new GetPlatformMovementBreakdownQuery("p1", FROM, TO, "month", "all"),
      );

      expect(result).toEqual([]);
    });
  });
});
