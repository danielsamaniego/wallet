import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetWalletMovementBreakdownUseCase } from "@/wallet/application/query/getWalletMovementBreakdown/usecase.js";
import { GetWalletMovementBreakdownQuery } from "@/wallet/application/query/getWalletMovementBreakdown/query.js";
import type {
  IWalletAnalyticsReadStore,
  MovementBreakdownBucketDTO,
} from "@/wallet/application/ports/walletAnalytics.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const FROM = 1_700_000_000_000;
const TO = 1_700_100_000_000;

describe("GetWalletMovementBreakdownUseCase", () => {
  const readStore = mock<IWalletAnalyticsReadStore>();
  const logger = createMockLogger();
  const useCase = new GetWalletMovementBreakdownUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the wallet has movements in range", () => {
    const buckets: MovementBreakdownBucketDTO[] = [
      { bucket: "deposit", sum_net_minor: 10000, sum_credits_minor: 10000, sum_debits_minor: 0, count: 3 },
    ];

    beforeEach(() => {
      readStore.aggregateMovements.mockResolvedValue(buckets);
    });

    it("Then it returns the buckets and delegates with the wallet scope", async () => {
      const result = await useCase.handle(
        ctx,
        new GetWalletMovementBreakdownQuery("w1", "p1", FROM, TO, "type", "all"),
      );

      expect(result).toEqual(buckets);
      expect(readStore.aggregateMovements).toHaveBeenCalledWith(ctx, {
        platformId: "p1",
        walletId: "w1",
        fromMs: FROM,
        toMs: TO,
        groupBy: "type",
        direction: "all",
        metadataKey: undefined,
      });
    });

    it("Then it forwards the metadata key when grouping by metadata", async () => {
      await useCase.handle(
        ctx,
        new GetWalletMovementBreakdownQuery("w1", "p1", FROM, TO, "metadata", "credit", "reasonKey"),
      );

      expect(readStore.aggregateMovements).toHaveBeenCalledWith(ctx, {
        platformId: "p1",
        walletId: "w1",
        fromMs: FROM,
        toMs: TO,
        groupBy: "metadata",
        direction: "credit",
        metadataKey: "reasonKey",
      });
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.aggregateMovements.mockResolvedValue(null);
    });

    it("Then it throws WALLET_NOT_FOUND", async () => {
      await expect(
        useCase.handle(ctx, new GetWalletMovementBreakdownQuery("w1", "p1", FROM, TO, "type", "all")),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.NotFound && e.code === "WALLET_NOT_FOUND",
      );
    });
  });
});
