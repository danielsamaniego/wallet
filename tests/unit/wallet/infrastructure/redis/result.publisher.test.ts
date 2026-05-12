import { describe, it, expect, vi } from "vitest";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import type { Redis } from "ioredis";
import { RedisResultPublisher } from "@/wallet/infrastructure/adapters/outbound/redis/result.publisher.js";

describe("RedisResultPublisher", () => {
  const ctx = createTestContext();
  const logger = createMockLogger();

  function buildPublisher(ttlSeconds?: number) {
    const set = vi.fn().mockResolvedValue("OK");
    const publish = vi.fn().mockResolvedValue(1);
    const redis = { set, publish } as unknown as Redis;
    const publisher = new RedisResultPublisher(redis, logger, ttlSeconds);
    return { publisher, set, publish };
  }

  describe("Given a posted result", () => {
    it("Then it SETs `movement:result:<id>` with the serialized payload and a TTL", async () => {
      const { publisher, set } = buildPublisher();

      await publisher.publish(ctx, { movementId: "mov-1", status: "posted" });

      expect(set).toHaveBeenCalledWith(
        "movement:result:mov-1",
        JSON.stringify({ movementId: "mov-1", status: "posted" }),
        "EX",
        60,
      );
    });

    it("Then it PUBLISHes the same payload on the same channel for any active subscribers", async () => {
      const { publisher, publish } = buildPublisher();

      await publisher.publish(ctx, { movementId: "mov-1", status: "posted" });

      expect(publish).toHaveBeenCalledWith(
        "movement:result:mov-1",
        JSON.stringify({ movementId: "mov-1", status: "posted" }),
      );
    });

    it("Then SET happens BEFORE PUBLISH so a subscriber that polls between the two still observes the result", async () => {
      const order: string[] = [];
      const set = vi.fn().mockImplementation(async () => {
        order.push("set");
        return "OK";
      });
      const publish = vi.fn().mockImplementation(async () => {
        order.push("publish");
        return 1;
      });
      const redis = { set, publish } as unknown as Redis;
      const publisher = new RedisResultPublisher(redis, logger);

      await publisher.publish(ctx, { movementId: "mov-1", status: "posted" });

      expect(order).toEqual(["set", "publish"]);
    });
  });

  describe("Given a failed result with a failedReason", () => {
    it("Then the failedReason is included in the payload", async () => {
      const { publisher, set } = buildPublisher();

      await publisher.publish(ctx, {
        movementId: "mov-2",
        status: "failed",
        failedReason: "qstash_max_attempts_exceeded",
      });

      const [, payload] = set.mock.calls[0]!;
      expect(JSON.parse(payload as string)).toEqual({
        movementId: "mov-2",
        status: "failed",
        failedReason: "qstash_max_attempts_exceeded",
      });
    });
  });

  describe("Given a failed result with full AppError fidelity (kind + code + reason)", () => {
    it("Then the payload carries failedKind + failedCode + failedReason so the handler can rebuild the AppError verbatim", async () => {
      const { publisher, set } = buildPublisher();

      await publisher.publish(ctx, {
        movementId: "mov-3",
        status: "failed",
        failedReason: "wallet w1 not found",
        failedKind: "NOT_FOUND",
        failedCode: "WALLET_NOT_FOUND",
      });

      const [, payload] = set.mock.calls[0]!;
      expect(JSON.parse(payload as string)).toEqual({
        movementId: "mov-3",
        status: "failed",
        failedReason: "wallet w1 not found",
        failedKind: "NOT_FOUND",
        failedCode: "WALLET_NOT_FOUND",
      });
    });
  });

  describe("Given a posted result carrying the service body (e.g. transactionId)", () => {
    it("Then the body round-trips through JSON intact so the awaiting handler can rebuild the sync-shape response", async () => {
      const { publisher, set, publish } = buildPublisher();

      await publisher.publish(ctx, {
        movementId: "mov-1",
        status: "posted",
        body: { transactionId: "tx-abc", movementId: "mov-1" },
      });

      const [, payload] = set.mock.calls[0]!;
      expect(JSON.parse(payload as string)).toEqual({
        movementId: "mov-1",
        status: "posted",
        body: { transactionId: "tx-abc", movementId: "mov-1" },
      });
      expect(publish).toHaveBeenCalledWith("movement:result:mov-1", payload);
    });
  });

  describe("Given a custom TTL", () => {
    it("Then SET uses the custom TTL instead of the 60-second default", async () => {
      const { publisher, set } = buildPublisher(120);

      await publisher.publish(ctx, { movementId: "mov-1", status: "posted" });

      expect(set).toHaveBeenCalledWith(expect.anything(), expect.anything(), "EX", 120);
    });
  });
});
