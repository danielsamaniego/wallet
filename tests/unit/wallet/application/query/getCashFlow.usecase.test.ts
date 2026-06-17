import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetCashFlowUseCase } from "@/wallet/application/query/getCashFlow/usecase.js";
import {
  GetCashFlowQuery,
  type CashFlowSummaryDTO,
} from "@/wallet/application/query/getCashFlow/query.js";
import type { IWalletAnalyticsReadStore } from "@/wallet/application/ports/walletAnalytics.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const FROM = 1_700_000_000_000;
const TO = 1_700_100_000_000;

describe("GetCashFlowUseCase", () => {
  const readStore = mock<IWalletAnalyticsReadStore>();
  const logger = createMockLogger();
  const useCase = new GetCashFlowUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the wallet has money flow in range", () => {
    const summary: CashFlowSummaryDTO = {
      income_minor: 10000,
      expense_minor: 3000,
      net_minor: 7000,
      days: 2,
    };

    beforeEach(() => {
      readStore.getCashFlow.mockResolvedValue(summary);
    });

    it("Then it returns the summary and delegates to the read store", async () => {
      const result = await useCase.handle(ctx, new GetCashFlowQuery("w1", "p1", FROM, TO));

      expect(result).toEqual(summary);
      expect(readStore.getCashFlow).toHaveBeenCalledWith(ctx, "w1", "p1", FROM, TO);
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getCashFlow.mockResolvedValue(null);
    });

    it("Then it throws WALLET_NOT_FOUND", async () => {
      await expect(
        useCase.handle(ctx, new GetCashFlowQuery("w1", "p1", FROM, TO)),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.NotFound && e.code === "WALLET_NOT_FOUND",
      );
    });
  });
});
