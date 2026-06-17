import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetBalanceTimeseriesUseCase } from "@/wallet/application/query/getBalanceTimeseries/usecase.js";
import {
  type BalanceTimeSeriesResponseDTO,
  GetBalanceTimeseriesQuery,
} from "@/wallet/application/query/getBalanceTimeseries/query.js";
import type { IWalletAnalyticsReadStore } from "@/wallet/application/ports/walletAnalytics.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const FROM = Date.parse("2024-01-01T00:00:00.000Z");
const TO = Date.parse("2024-01-05T00:00:00.000Z"); // 5 days, within the cap

describe("GetBalanceTimeseriesUseCase", () => {
  const readStore = mock<IWalletAnalyticsReadStore>();
  const logger = createMockLogger();
  const useCase = new GetBalanceTimeseriesUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given a valid range and an existing wallet", () => {
    const response: BalanceTimeSeriesResponseDTO = {
      points: [{ date: "2024-01-01", balance_minor: 100 }],
    };

    beforeEach(() => {
      readStore.getBalanceTimeseries.mockResolvedValue(response);
    });

    it("Then it returns the series and delegates to the read store", async () => {
      const result = await useCase.handle(ctx, new GetBalanceTimeseriesQuery("w1", "p1", FROM, TO));

      expect(result).toEqual(response);
      expect(readStore.getBalanceTimeseries).toHaveBeenCalledWith(ctx, "w1", "p1", FROM, TO);
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getBalanceTimeseries.mockResolvedValue(null);
    });

    it("Then it throws WALLET_NOT_FOUND", async () => {
      await expect(
        useCase.handle(ctx, new GetBalanceTimeseriesQuery("w1", "p1", FROM, TO)),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.NotFound && e.code === "WALLET_NOT_FOUND",
      );
    });
  });

  describe("Given a range exceeding the maximum number of days", () => {
    it("Then it throws RANGE_TOO_LARGE and never touches the read store", async () => {
      const from = Date.parse("2020-01-01T00:00:00.000Z");
      const to = Date.parse("2024-01-01T00:00:00.000Z"); // ~1461 days

      await expect(
        useCase.handle(ctx, new GetBalanceTimeseriesQuery("w1", "p1", from, to)),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.Validation && e.code === "RANGE_TOO_LARGE",
      );
      expect(readStore.getBalanceTimeseries).not.toHaveBeenCalled();
    });
  });
});
