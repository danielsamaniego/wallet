import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { IIDGenerator } from "@/utils/application/id.generator.js";
import {
  LockBackendUnavailableError,
  LockContendedError,
} from "@/utils/application/distributed.lock.js";
import { RedisDistributedLock } from "@/utils/infrastructure/redis.distributed.lock.js";
import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

function ctx(): AppContext {
  return {
    trackingId: "trk-redis",
    startTs: Date.now(),
    canonical: new CanonicalAccumulator(),
  };
}

function seqIdGen(): IIDGenerator {
  let i = 0;
  return { newId: () => `tok-${++i}` };
}

describe("RedisDistributedLock", () => {
  describe("Given a Redis client that accepts the first SET NX", () => {
    describe("When acquire is called", () => {
      it("Then returns a handle with the generated token and issues SET key token PX ttl NX", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "wallet-lock:abc", {
          ttlMs: 10_000,
          waitMs: 100,
        });

        expect(handle.key).toBe("wallet-lock:abc");
        expect(handle.token).toBe("tok-1");
        expect(redis.set).toHaveBeenCalledWith("wallet-lock:abc", "tok-1", "PX", 10_000, "NX");
      });
    });
  });

  describe("Given a Redis client that always returns null (key held)", () => {
    describe("When acquire is called with short waitMs", () => {
      it("Then throws LockContendedError after the deadline and logs a warn", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue(null);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 30, retryMs: 5 }),
        ).rejects.toBeInstanceOf(LockContendedError);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe("Given the first SET returns null (held) then OK (freed)", () => {
    describe("When acquire is called with waitMs long enough", () => {
      it("Then succeeds on a later attempt and logs info 'ok after contention'", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValueOnce(null).mockResolvedValueOnce("OK");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", {
          ttlMs: 1_000,
          waitMs: 200,
          retryMs: 5,
        });
        expect(handle.key).toBe("k");
        expect(logger.info).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("ok after contention"),
          expect.objectContaining({ attempts: 2 }),
        );
      });
    });
  });

  describe("Given the SET call rejects with a network error", () => {
    describe("When acquire is called", () => {
      it("Then throws LockBackendUnavailableError and the error is logged", async () => {
        const redis = mock<Redis>();
        redis.set.mockRejectedValue(new Error("ECONNREFUSED"));
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 100 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe("Given the SET rejects with an error that carries a system code", () => {
    describe("When acquire is called", () => {
      it("Then the log payload includes error_code alongside error_name/error", async () => {
        const redis = mock<Redis>();
        const sysErr = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
          code: "ECONNREFUSED",
        });
        redis.set.mockRejectedValue(sysErr);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 100 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("backend error"),
          expect.objectContaining({
            error: expect.stringContaining("ECONNREFUSED"),
            error_name: "Error",
            error_code: "ECONNREFUSED",
          }),
        );
      });
    });
  });

  describe("Given a 'Command timed out' on the first SET, then OK on the second", () => {
    describe("When acquire is called with waitMs long enough", () => {
      it("Then the transient timeout is retried and the handle is returned", async () => {
        const redis = mock<Redis>();
        redis.set
          .mockRejectedValueOnce(new Error("Command timed out"))
          .mockResolvedValueOnce("OK");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", {
          ttlMs: 1_000,
          waitMs: 200,
          retryMs: 5,
        });

        expect(handle.key).toBe("k");
        expect(redis.set).toHaveBeenCalledTimes(2);
        // Transient errors log at debug, not warn — the caller should not be
        // alerted about a single timeout that was successfully retried.
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given every SET rejects with 'Command timed out' (backend unresponsive)", () => {
    describe("When acquire is called and waitMs elapses without a single response", () => {
      it("Then throws LockBackendUnavailableError (NOT LockContendedError) so the runner can fall through", async () => {
        const redis = mock<Redis>();
        redis.set.mockRejectedValue(new Error("Command timed out"));
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 30, retryMs: 5 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("unresponsive"),
          expect.any(Object),
        );
      });
    });
  });

  describe("Given a mix of 'Command timed out' and null responses during contention", () => {
    describe("When waitMs elapses after seeing at least one null response", () => {
      it("Then throws LockContendedError (backend alive but key held)", async () => {
        const redis = mock<Redis>();
        redis.set
          .mockRejectedValueOnce(new Error("Command timed out"))
          .mockResolvedValue(null);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 30, retryMs: 5 }),
        ).rejects.toBeInstanceOf(LockContendedError);
      });
    });
  });

  describe("Given the SET call rejects with a non-Error value (string)", () => {
    describe("When acquire is called", () => {
      it("Then still throws LockBackendUnavailableError wrapping the stringified value", async () => {
        const redis = mock<Redis>();
        redis.set.mockRejectedValue("raw-string-err");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 100 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
      });
    });
  });

  describe("Given the eval call rejects with a non-Error value during release", () => {
    describe("When handle.release is called", () => {
      it("Then throws LockBackendUnavailableError wrapping the stringified value", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockRejectedValue("bad-release-string");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await expect(handle.release()).rejects.toBeInstanceOf(LockBackendUnavailableError);
      });
    });
  });

  describe("Given a successfully acquired handle", () => {
    describe("When release is called", () => {
      it("Then invokes Lua eval with the key and token arguments", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await handle.release();

        expect(redis.eval).toHaveBeenCalledTimes(1);
        const args = redis.eval.mock.calls[0];
        expect(args?.[1]).toBe(1); // number of KEYS
        expect(args?.[2]).toBe("k");
        expect(args?.[3]).toBe("tok-1");
      });
    });

    describe("When release's Lua eval returns 0 (token mismatch)", () => {
      it("Then logs a warn with 'token mismatch' so TTL-expiry incidents are visible in prod", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(0 as unknown as never); // token didn't match
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await handle.release();

        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("token mismatch"),
          expect.objectContaining({ key: "k", token: "tok-1" }),
        );
      });
    });

    describe("When eval rejects with a network error during release", () => {
      it("Then throws LockBackendUnavailableError wrapping the cause", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockRejectedValue(new Error("network down"));
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await expect(handle.release()).rejects.toBeInstanceOf(LockBackendUnavailableError);
      });
    });
  });

  describe("Given withLock", () => {
    describe("When fn succeeds", () => {
      it("Then release is called and the value is returned", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const value = await lock.withLock(ctx(), "k", { ttlMs: 1_000, waitMs: 50 }, async () => "v");
        expect(value).toBe("v");
        expect(redis.eval).toHaveBeenCalledTimes(1);
      });
    });

    describe("When fn throws", () => {
      it("Then release is still attempted and the error propagates", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.withLock(ctx(), "k", { ttlMs: 1_000, waitMs: 50 }, async () => {
            throw new Error("boom");
          }),
        ).rejects.toThrow("boom");
        expect(redis.eval).toHaveBeenCalledTimes(1);
      });
    });

    describe("When release fails after fn succeeds", () => {
      it("Then the fn result is returned and the release error is logged, not thrown", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockRejectedValue(new Error("release-fail"));
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const value = await lock.withLock(ctx(), "k", { ttlMs: 1_000, waitMs: 50 }, async () => 99);
        expect(value).toBe(99);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe("Given withLocks", () => {
    describe("When given multiple unsorted keys", () => {
      it("Then acquires in sorted order and releases in reverse order", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await lock.withLocks(
          ctx(),
          ["wallet-lock:B", "wallet-lock:A"],
          { ttlMs: 1_000, waitMs: 50 },
          async () => "ok",
        );

        const setKeys = redis.set.mock.calls.map((c) => c[0]);
        expect(setKeys).toEqual(["wallet-lock:A", "wallet-lock:B"]);

        // Eval calls in reverse order — last-acquired released first
        const evalKeys = redis.eval.mock.calls.map((c) => c[2]);
        expect(evalKeys).toEqual(["wallet-lock:B", "wallet-lock:A"]);
      });
    });

    describe("When the second lock in withLocks contends", () => {
      it("Then the first (already-acquired) lock is released and LockContendedError propagates", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValueOnce("OK").mockResolvedValue(null); // 2nd key contends forever
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.withLocks(ctx(), ["a", "b"], { ttlMs: 1_000, waitMs: 20, retryMs: 5 }, async () =>
            undefined,
          ),
        ).rejects.toBeInstanceOf(LockContendedError);

        // The first lock should have been released via eval
        expect(redis.eval).toHaveBeenCalledTimes(1);
      });
    });

    describe("When release of one lock fails during cleanup", () => {
      it("Then the remaining locks still get their release attempted", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        // First eval (reverse order: last key first) rejects; second succeeds
        redis.eval
          .mockRejectedValueOnce(new Error("release-fail"))
          .mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await lock.withLocks(ctx(), ["a", "b"], { ttlMs: 1_000, waitMs: 50 }, async () => undefined);

        expect(redis.eval).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe("Given canonical metrics", () => {
    describe("When acquire succeeds on the first SET", () => {
      it("Then lock.attempts is incremented once and no transient counter is emitted", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });

        const increments = logger.incrementCanonical.mock.calls;
        const attemptsCalls = increments.filter((c) => c[1] === "lock.attempts");
        expect(attemptsCalls).toHaveLength(1);
        expect(attemptsCalls[0]?.[2]).toBe(1);
        const transientCalls = increments.filter((c) => c[1] === "lock.transient_errors");
        expect(transientCalls).toHaveLength(0);
      });
    });

    describe("When acquire retries after a transient 'Command timed out'", () => {
      it("Then lock.attempts is incremented per poll and lock.transient_errors captures the retry", async () => {
        const redis = mock<Redis>();
        redis.set
          .mockRejectedValueOnce(new Error("Command timed out"))
          .mockResolvedValueOnce("OK");
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 200, retryMs: 5 });

        const increments = logger.incrementCanonical.mock.calls;
        expect(increments.filter((c) => c[1] === "lock.attempts")).toHaveLength(2);
        expect(increments.filter((c) => c[1] === "lock.transient_errors")).toHaveLength(1);
      });
    });

    describe("When release returns token mismatch (deleted=0)", () => {
      it("Then lock.token_mismatch is incremented", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(0 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new RedisDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await handle.release();

        const mismatchCalls = logger.incrementCanonical.mock.calls.filter(
          (c) => c[1] === "lock.token_mismatch",
        );
        expect(mismatchCalls).toHaveLength(1);
      });
    });
  });
});
