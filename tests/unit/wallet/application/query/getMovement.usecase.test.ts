import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetMovementUseCase } from "@/wallet/application/query/getMovement/usecase.js";
import { GetMovementQuery } from "@/wallet/application/query/getMovement/query.js";
import type { WalletMovementDTO } from "@/wallet/application/query/getWalletMovements/query.js";
import type { IWalletMovementReadStore } from "@/wallet/application/ports/walletMovement.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

const WALLET_ID = "wallet-1";
const MOVEMENT_ID = "mv-1";
const PLATFORM_ID = "platform-1";

const movement: WalletMovementDTO = {
  movement_id: MOVEMENT_ID,
  transaction_id: "tx-1",
  type: "charge",
  amount_minor: 3000,
  direction: "debit",
  reason: null,
  reference: "COMMISSION",
  metadata: { order_id: "order-1" },
  counterpart_wallet_id: null,
  hold_id: null,
  status: "completed",
  balance_before_minor: 10000,
  balance_after_minor: 7000,
  created_at: 1700000000000,
};

describe("GetMovementUseCase", () => {
  const readStore = mock<IWalletMovementReadStore>();
  const logger = createMockLogger();
  const useCase = new GetMovementUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given the movement exists for the wallet and platform", () => {
    beforeEach(() => {
      readStore.getOne.mockResolvedValue(movement);
    });

    describe("When the movement is queried by id", () => {
      it("Then it returns the movement and delegates to the read store", async () => {
        const query = new GetMovementQuery(WALLET_ID, MOVEMENT_ID, PLATFORM_ID);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(movement);
        expect(readStore.getOne).toHaveBeenCalledWith(ctx, WALLET_ID, MOVEMENT_ID, PLATFORM_ID);
      });
    });
  });

  describe("Given the movement does not exist for the wallet/platform", () => {
    beforeEach(() => {
      readStore.getOne.mockResolvedValue(null);
    });

    describe("When the movement is queried by id", () => {
      it("Then it throws MOVEMENT_NOT_FOUND", async () => {
        const query = new GetMovementQuery(WALLET_ID, MOVEMENT_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "MOVEMENT_NOT_FOUND";
        });
      });
    });
  });
});
