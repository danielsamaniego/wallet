import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import type { Client as QStashClient } from "@upstash/qstash";
import { QStashMovementQueuePublisher } from "@/wallet/infrastructure/adapters/outbound/qstash/movement.queue.publisher.js";

const QUEUE_NAME = "wallet-movements";
const DESTINATION_URL = "https://wallet.example.com/internal/worker/process-movement";

describe("QStashMovementQueuePublisher", () => {
  const ctx = createTestContext();
  const logger = createMockLogger();

  function buildPublisher() {
    const enqueueJSON = vi.fn().mockResolvedValue({ messageId: "msg_abc123" });
    const queue = vi.fn().mockReturnValue({ enqueueJSON });
    const client = { queue } as unknown as QStashClient;
    const publisher = new QStashMovementQueuePublisher(
      client,
      QUEUE_NAME,
      DESTINATION_URL,
      logger,
    );
    return { publisher, client, queue, enqueueJSON };
  }

  describe("Given a movement to publish without idempotencyKey", () => {
    it("Then it selects the configured queue and enqueues a JSON payload containing only movement_id", async () => {
      const { publisher, queue, enqueueJSON } = buildPublisher();

      await publisher.publish(ctx, { movementId: "mov-1" });

      expect(queue).toHaveBeenCalledWith({ queueName: QUEUE_NAME });
      expect(enqueueJSON).toHaveBeenCalledWith({
        url: DESTINATION_URL,
        body: { movement_id: "mov-1" },
      });
    });
  });

  describe("Given a movement to publish WITH idempotencyKey", () => {
    it("Then it forwards the key as `deduplicationId` so QStash dedupes redeliveries before they hit the worker", async () => {
      const { publisher, enqueueJSON } = buildPublisher();

      await publisher.publish(ctx, { movementId: "mov-1", idempotencyKey: "idem-1" });

      expect(enqueueJSON).toHaveBeenCalledWith({
        url: DESTINATION_URL,
        body: { movement_id: "mov-1" },
        deduplicationId: "idem-1",
      });
    });
  });

  describe("Given the underlying QStash call resolves with a messageId", () => {
    it("Then the publisher returns successfully (fire-and-forget contract)", async () => {
      const { publisher } = buildPublisher();

      await expect(publisher.publish(ctx, { movementId: "mov-1" })).resolves.toBeUndefined();
    });
  });

  describe("Given a QStash response without a messageId (defensive)", () => {
    it("Then publish still resolves — messageId is purely informational for logging", async () => {
      const enqueueJSON = vi.fn().mockResolvedValue({});
      const queue = vi.fn().mockReturnValue({ enqueueJSON });
      const client = { queue } as unknown as QStashClient;
      const publisher = new QStashMovementQueuePublisher(
        client,
        QUEUE_NAME,
        DESTINATION_URL,
        logger,
      );

      await expect(publisher.publish(ctx, { movementId: "mov-1" })).resolves.toBeUndefined();
    });
  });

  describe("Given the underlying QStash call rejects (network/auth error)", () => {
    it("Then the error propagates to the caller so the handler can rollback the pending Movement", async () => {
      const enqueueJSON = vi.fn().mockRejectedValue(new Error("network unreachable"));
      const queue = vi.fn().mockReturnValue({ enqueueJSON });
      const client = { queue } as unknown as QStashClient;
      const publisher = new QStashMovementQueuePublisher(
        client,
        QUEUE_NAME,
        DESTINATION_URL,
        logger,
      );

      await expect(publisher.publish(ctx, { movementId: "mov-1" })).rejects.toThrow(
        "network unreachable",
      );
    });
  });
});
