import { describe, it, expect, beforeEach } from "vitest";
import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
} from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { EnqueueMovementUseCase } from "@/wallet/application/command/enqueueMovement/usecase.js";
import { EnqueueMovementCommand } from "@/wallet/application/command/enqueueMovement/command.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import type { IMovementQueuePublisher } from "@/wallet/domain/ports/movement.queue.publisher.js";
import type { Movement } from "@/wallet/domain/movement/movement.entity.js";

const PLATFORM_ID = "platform-1";
const IDEM_KEY = "idem-abc";

describe("EnqueueMovementUseCase", () => {
  const movementRepo = mock<IMovementRepository>();
  const queuePublisher = mock<IMovementQueuePublisher>();
  const idGen = createMockIDGenerator(["mov-new"]);
  const logger = createMockLogger();
  const ctx = createTestContext();

  const sut = new EnqueueMovementUseCase(movementRepo, queuePublisher, idGen, logger);

  const payload = { walletId: "wallet-1", amountMinor: 500, idempotencyKey: IDEM_KEY };

  beforeEach(() => {
    mockReset(movementRepo);
    mockReset(queuePublisher);
    idGen.reset();
  });

  describe("Given a valid deposit enqueue command", () => {
    const cmd = new EnqueueMovementCommand("deposit", PLATFORM_ID, IDEM_KEY, payload);

    describe("When handle is called", () => {
      it("Then it returns the generated movementId", async () => {
        const result = await sut.handle(ctx, cmd);
        expect(result).toEqual({ movementId: "mov-new" });
      });

      it("Then it INSERTs a pending Movement carrying type, platformId and queuePayload", async () => {
        await sut.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
        const saved = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(saved.id).toBe("mov-new");
        expect(saved.type).toBe("deposit");
        expect(saved.platformId).toBe(PLATFORM_ID);
        expect(saved.status).toBe("pending");
        expect(saved.queuePayload).toEqual(payload);
        expect(saved.reason).toBeNull();
      });

      it("Then it publishes the movement to QStash forwarding the idempotencyKey as deduplicationId", async () => {
        await sut.handle(ctx, cmd);

        expect(queuePublisher.publish).toHaveBeenCalledOnce();
        const [, message] = queuePublisher.publish.mock.calls[0]!;
        expect(message).toEqual({ movementId: "mov-new", idempotencyKey: IDEM_KEY });
      });

      it("Then the Movement is saved BEFORE the publish (so a delivered message always finds a row)", async () => {
        const order: string[] = [];
        movementRepo.save.mockImplementation(async () => {
          order.push("save");
        });
        queuePublisher.publish.mockImplementation(async () => {
          order.push("publish");
        });

        await sut.handle(ctx, cmd);

        expect(order).toEqual(["save", "publish"]);
      });
    });
  });

  describe("Given an adjustment with a reason", () => {
    const cmd = new EnqueueMovementCommand(
      "adjustment",
      PLATFORM_ID,
      IDEM_KEY,
      { walletId: "wallet-1", amountMinor: -1000, reason: "Manual fee" },
      "Manual fee",
    );

    describe("When handle is called", () => {
      it("Then the Movement carries the reason text alongside the queuePayload", async () => {
        await sut.handle(ctx, cmd);

        const saved = movementRepo.save.mock.calls[0]![1] as Movement;
        expect(saved.type).toBe("adjustment");
        expect(saved.reason).toBe("Manual fee");
      });
    });
  });

  describe("Given the queue publisher rejects (network/auth failure)", () => {
    const cmd = new EnqueueMovementCommand("deposit", PLATFORM_ID, IDEM_KEY, payload);

    describe("When handle is called", () => {
      it("Then the error propagates so the HTTP layer can surface 5xx (the pending row stays as a known orphan for the reconciliation job)", async () => {
        queuePublisher.publish.mockRejectedValue(new Error("QStash unreachable"));

        await expect(sut.handle(ctx, cmd)).rejects.toThrow("QStash unreachable");
        // The pending Movement WAS inserted before the publish failed — leaving
        // it allows a later reconciliation/republish job to recover. Going
        // further (UPDATE pending → failed) requires extending the state
        // machine; deferred to a later phase.
        expect(movementRepo.save).toHaveBeenCalledOnce();
      });
    });
  });
});
