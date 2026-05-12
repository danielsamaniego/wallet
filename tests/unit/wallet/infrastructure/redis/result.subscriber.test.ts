import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import type { Redis } from "ioredis";
import { RedisResultSubscriber } from "@/wallet/infrastructure/adapters/outbound/redis/result.subscriber.js";

describe("RedisResultSubscriber", () => {
  const ctx = createTestContext();
  const logger = createMockLogger();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildSubscriber(redisGet: (key: string) => Promise<string | null>) {
    const get = vi.fn().mockImplementation(redisGet);
    const redis = { get } as unknown as Redis;
    const subscriber = new RedisResultSubscriber(redis, logger);
    return { subscriber, get };
  }

  describe("Given the result is already present in Redis", () => {
    it("Then the FIRST poll observes it and waitFor returns the parsed MovementResult immediately", async () => {
      const payload = JSON.stringify({ movementId: "mov-1", status: "posted" });
      const { subscriber, get } = buildSubscriber(async () => payload);

      const result = await subscriber.waitFor(ctx, "mov-1", { timeoutMs: 1500 });

      expect(result).toEqual({ movementId: "mov-1", status: "posted" });
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith("movement:result:mov-1");
    });
  });

  describe("Given the result arrives after a few polls", () => {
    it("Then waitFor keeps polling until the value appears and then returns it", async () => {
      let callCount = 0;
      const { subscriber, get } = buildSubscriber(async () => {
        callCount++;
        if (callCount < 3) return null;
        return JSON.stringify({ movementId: "mov-1", status: "posted" });
      });

      const promise = subscriber.waitFor(ctx, "mov-1", { timeoutMs: 1500, pollMs: 50 });

      // Advance through the two missed polls + one that finds the value.
      await vi.advanceTimersByTimeAsync(150);

      const result = await promise;
      expect(result).toEqual({ movementId: "mov-1", status: "posted" });
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Given the timeout elapses before any result is published", () => {
    it("Then waitFor returns null without throwing", async () => {
      const { subscriber } = buildSubscriber(async () => null);

      const promise = subscriber.waitFor(ctx, "mov-1", { timeoutMs: 200, pollMs: 50 });

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe("Given Redis throws on a poll (transient error)", () => {
    it("Then waitFor swallows the error, keeps polling, and returns the result when it eventually arrives", async () => {
      let callCount = 0;
      const { subscriber } = buildSubscriber(async () => {
        callCount++;
        if (callCount === 1) throw new Error("connection refused");
        if (callCount < 3) return null;
        return JSON.stringify({ movementId: "mov-1", status: "posted" });
      });

      const promise = subscriber.waitFor(ctx, "mov-1", { timeoutMs: 1500, pollMs: 50 });
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toEqual({ movementId: "mov-1", status: "posted" });
    });
  });

  describe("Given Redis keeps throwing for the entire window", () => {
    it("Then waitFor swallows every error and returns null at the timeout (caller falls back to 202)", async () => {
      const { subscriber } = buildSubscriber(async () => {
        throw new Error("backend down");
      });

      const promise = subscriber.waitFor(ctx, "mov-1", { timeoutMs: 200, pollMs: 50 });
      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe("Given the get call itself takes longer than the remaining time window", () => {
    it("Then the post-get sleep is skipped (defensive branch) and waitFor returns null at the deadline", async () => {
      vi.useRealTimers();
      const get = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return null;
      });
      const redis = { get } as unknown as Redis;
      const subscriber = new RedisResultSubscriber(redis, logger);

      const result = await subscriber.waitFor(ctx, "mov-1", { timeoutMs: 20, pollMs: 100 });

      expect(result).toBeNull();
    });
  });

  describe("Given a failed result with full AppError fidelity (kind + code + reason)", () => {
    it("Then waitFor returns the MovementResult including failedKind + failedCode so the handler can rebuild the AppError", async () => {
      const payload = JSON.stringify({
        movementId: "mov-f",
        status: "failed",
        failedReason: "wallet w1 not found",
        failedKind: "NOT_FOUND",
        failedCode: "WALLET_NOT_FOUND",
      });
      const { subscriber } = buildSubscriber(async () => payload);

      const result = await subscriber.waitFor(ctx, "mov-f", { timeoutMs: 1500 });

      expect(result).toEqual({
        movementId: "mov-f",
        status: "failed",
        failedReason: "wallet w1 not found",
        failedKind: "NOT_FOUND",
        failedCode: "WALLET_NOT_FOUND",
      });
    });
  });

  describe("Given a posted result that carries a service body", () => {
    it("Then waitFor returns the parsed MovementResult including the body so the awaiting handler can rebuild the sync-shape response", async () => {
      const payload = JSON.stringify({
        movementId: "mov-1",
        status: "posted",
        body: { transactionId: "tx-abc", movementId: "mov-1" },
      });
      const { subscriber } = buildSubscriber(async () => payload);

      const result = await subscriber.waitFor(ctx, "mov-1", { timeoutMs: 1500 });

      expect(result).toEqual({
        movementId: "mov-1",
        status: "posted",
        body: { transactionId: "tx-abc", movementId: "mov-1" },
      });
    });
  });

  describe("Given a custom pollMs option", () => {
    it("Then it is used between probes (verified by call count over a fixed window)", async () => {
      const { subscriber, get } = buildSubscriber(async () => null);

      const promise = subscriber.waitFor(ctx, "mov-1", { timeoutMs: 500, pollMs: 200 });
      await vi.advanceTimersByTimeAsync(550);

      await promise;
      // With pollMs=200 and timeout=500, expect roughly 3 calls (t=0, t=200, t=400)
      expect(get.mock.calls.length).toBeLessThanOrEqual(4);
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
