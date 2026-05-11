import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetMovementUseCase } from "@/wallet/application/query/getMovement/usecase.js";
import { GetMovementQuery } from "@/wallet/application/query/getMovement/query.js";
import type { MovementDTO } from "@/wallet/application/query/getMovement/query.js";
import type { IMovementReadStore } from "@/wallet/application/ports/movement.readstore.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Shared fixtures ────────────────────────────────────────────────

const MOVEMENT_ID = "mov-1";
const PLATFORM_ID = "platform-1";

const postedDTO: MovementDTO = {
  id: MOVEMENT_ID,
  type: "deposit",
  status: "posted",
  reason: null,
  failed_reason: null,
  created_at: 1700000000000,
};

const failedDTO: MovementDTO = {
  id: MOVEMENT_ID,
  type: "deposit",
  status: "failed",
  reason: null,
  failed_reason: "qstash_max_attempts_exceeded",
  created_at: 1700000000000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("GetMovementUseCase", () => {
  const readStore = mock<IMovementReadStore>();
  const logger = createMockLogger();
  const useCase = new GetMovementUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  describe("Given a posted movement exists for the requesting platform", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(postedDTO);
    });

    describe("When the movement is queried by id", () => {
      it("Then it returns the movement DTO and scopes by platform_id", async () => {
        const query = new GetMovementQuery(MOVEMENT_ID, PLATFORM_ID);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(postedDTO);
        expect(readStore.getById).toHaveBeenCalledWith(ctx, MOVEMENT_ID, PLATFORM_ID);
      });
    });
  });

  describe("Given a failed movement exists for the requesting platform", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(failedDTO);
    });

    describe("When the movement is queried by id", () => {
      it("Then it returns the failure reason alongside the status", async () => {
        const query = new GetMovementQuery(MOVEMENT_ID, PLATFORM_ID);

        const result = await useCase.handle(ctx, query);

        expect(result.status).toBe("failed");
        expect(result.failed_reason).toBe("qstash_max_attempts_exceeded");
      });
    });
  });

  describe("Given no movement exists (or it belongs to another platform)", () => {
    beforeEach(() => {
      readStore.getById.mockResolvedValue(null);
    });

    describe("When the movement is queried", () => {
      it("Then it throws MOVEMENT_NOT_FOUND", async () => {
        const query = new GetMovementQuery(MOVEMENT_ID, PLATFORM_ID);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "MOVEMENT_NOT_FOUND";
        });
      });
    });
  });
});
