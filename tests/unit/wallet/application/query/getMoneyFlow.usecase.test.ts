import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetMoneyFlowUseCase } from "@/wallet/application/query/getMoneyFlow/usecase.js";
import {
  GetMoneyFlowQuery,
  type MoneyFlowSummaryDTO,
} from "@/wallet/application/query/getMoneyFlow/query.js";
import type { IWalletAnalyticsReadStore } from "@/wallet/application/ports/walletAnalytics.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const FROM = 1_700_000_000_000;
const TO = 1_700_100_000_000;

describe("GetMoneyFlowUseCase", () => {
  const readStore = mock<IWalletAnalyticsReadStore>();
  const logger = createMockLogger();
  const useCase = new GetMoneyFlowUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the wallet has money flow in range", () => {
    const summary: MoneyFlowSummaryDTO = {
      income_minor: 10000,
      expense_minor: 3000,
      net_minor: 7000,
      days: 2,
    };

    beforeEach(() => {
      readStore.getMoneyFlow.mockResolvedValue(summary);
    });

    it("Then it returns the summary and delegates to the read store", async () => {
      const result = await useCase.handle(ctx, new GetMoneyFlowQuery("w1", "p1", FROM, TO));

      expect(result).toEqual(summary);
      expect(readStore.getMoneyFlow).toHaveBeenCalledWith(ctx, "w1", "p1", FROM, TO);
    });
  });

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getMoneyFlow.mockResolvedValue(null);
    });

    it("Then it throws WALLET_NOT_FOUND", async () => {
      await expect(
        useCase.handle(ctx, new GetMoneyFlowQuery("w1", "p1", FROM, TO)),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.NotFound && e.code === "WALLET_NOT_FOUND",
      );
    });
  });
});
