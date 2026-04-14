import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetHoldUseCase } from "@/wallet/application/query/getHold/usecase.js";
import { GetHoldQuery } from "@/wallet/application/query/getHold/query.js";
import type { HoldDTO } from "@/wallet/application/query/getHold/query.js";
import type { IHoldReadStore } from "@/wallet/application/ports/hold.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Shared fixtures ────────────────────────────────────────────────

const HOLD_ID = "hold-1";
const PLATFORM_ID = "platform-1";

const holdDTO: HoldDTO = {
  id: HOLD_ID,
  wallet_id: "wallet-1",
  amount_cents: 5000,
  status: "ACTIVE",
  reference: "ref-001",
  expires_at: 1700100000000,
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("GetHoldUseCase", () => {
  const readStore = mock<IHoldReadStore>();
  const logger = createMockLogger();
  const useCase = new GetHoldUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Hold found ────────────────────────────────────────────────

  describe("Given a hold exists in the read store", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(holdDTO);
    });

    describe("When the hold is queried by id", () => {
      it("Then it returns the hold DTO", async () => {
        const query = new GetHoldQuery(HOLD_ID, PLATFORM_ID);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(holdDTO);
        expect(readStore.getById).toHaveBeenCalledWith(ctx, HOLD_ID, PLATFORM_ID);
      });
    });
  });

  // ── Hold not found ────────────────────────────────────────────

  describe("Given no hold exists for the given id", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(null);
    });

    describe("When the hold is queried", () => {
      it("Then it throws HOLD_NOT_FOUND", async () => {
        const query = new GetHoldQuery(HOLD_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "HOLD_NOT_FOUND";
        });
      });
    });
  });
});
