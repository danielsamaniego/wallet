import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetMovementStatementUseCase } from "@/wallet/application/query/getMovementStatement/usecase.js";
import {
  GetMovementStatementQuery,
  type GlobalStatementEntryDTO,
} from "@/wallet/application/query/getMovementStatement/query.js";
import type { IStatementReadStore } from "@/wallet/application/ports/statement.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const PLATFORM_ID = "platform-1";
const MOVEMENT_ID = "mv-1";

function face(overrides?: Partial<GlobalStatementEntryDTO>): GlobalStatementEntryDTO {
  return {
    movement_id: MOVEMENT_ID,
    transaction_id: "tx-1",
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
    wallet_id: "wallet-1",
    owner_id: "owner-1",
    ...overrides,
  };
}

describe("GetMovementStatementUseCase", () => {
  const readStore = mock<IStatementReadStore>();
  const logger = createMockLogger();
  const useCase = new GetMovementStatementUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the movement has user-facing faces", () => {
    it("Then it returns every face and delegates with the platform scope", async () => {
      const faces = [
        face({ direction: "debit", type: "transfer_out", wallet_id: "wallet-1", owner_id: "owner-1" }),
        face({ direction: "credit", type: "transfer_in", wallet_id: "wallet-2", owner_id: "owner-2" }),
      ];
      readStore.getByMovement.mockResolvedValue(faces);

      const result = await useCase.handle(
        ctx,
        new GetMovementStatementQuery(MOVEMENT_ID, PLATFORM_ID),
      );

      expect(result).toEqual(faces);
      expect(readStore.getByMovement).toHaveBeenCalledWith(ctx, MOVEMENT_ID, PLATFORM_ID);
    });
  });

  describe("Given no user-facing face exists for the platform", () => {
    beforeEach(() => {
      readStore.getByMovement.mockResolvedValue([]);
    });

    it("Then it throws MOVEMENT_NOT_FOUND", async () => {
      await expect(
        useCase.handle(ctx, new GetMovementStatementQuery(MOVEMENT_ID, PLATFORM_ID)),
      ).rejects.toSatisfy(
        (e: AppError) => e.kind === ErrorKind.NotFound && e.code === "MOVEMENT_NOT_FOUND",
      );
    });
  });
});
