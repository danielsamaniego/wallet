import type { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";
import {
  LockBackendUnavailableError,
  LockContendedError,
} from "@/utils/application/distributed.lock.js";
import type { IIDGenerator } from "@/utils/application/id.generator.js";
import {
  parseUpstashRestCredentials,
  UpstashRestDistributedLock,
} from "@/utils/infrastructure/upstash.rest.distributed.lock.js";
import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

function ctx(): AppContext {
  return {
    trackingId: "trk-upstash-rest",
    startTs: Date.now(),
    canonical: new CanonicalAccumulator(),
  };
}

function seqIdGen(): IIDGenerator {
  let i = 0;
  return { newId: () => `tok-${++i}` };
}

describe("parseUpstashRestCredentials", () => {
  describe("Given a valid rediss:// URL with user:token@host", () => {
    describe("When parsing", () => {
      it("Then returns { url: https://<host>, token }", () => {
        const result = parseUpstashRestCredentials(
          "rediss://default:secret-token-123@skilled-baboon-103521.upstash.io:6379",
        );
        expect(result).toEqual({
          url: "https://skilled-baboon-103521.upstash.io",
          token: "secret-token-123",
        });
      });
    });
  });

  describe("Given a URL without a password/token component", () => {
    describe("When parsing", () => {
      it("Then throws a descriptive error", () => {
        expect(() => parseUpstashRestCredentials("rediss://host.example:6379")).toThrow(
          /missing the token/i,
        );
      });
    });
  });
});

describe("UpstashRestDistributedLock", () => {
  describe("Given a client that accepts the first SET NX", () => {
    describe("When acquire is called", () => {
      it("Then returns a handle with the generated token and issues SET with nx+px options", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "wallet-lock:abc", {
          ttlMs: 10_000,
          waitMs: 100,
        });

        expect(handle.key).toBe("wallet-lock:abc");
        expect(handle.token).toBe("tok-1");
        expect(redis.set).toHaveBeenCalledWith("wallet-lock:abc", "tok-1", {
          nx: true,
          px: 10_000,
        });
      });
    });
  });

  describe("Given a client that always returns null (key held)", () => {
    describe("When acquire is called with short waitMs", () => {
      it("Then throws LockContendedError after the deadline and logs a warn", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue(null);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
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

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
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

  describe("Given the SET call rejects with any error (HTTP, fetch, auth)", () => {
    describe("When acquire is called", () => {
      it("Then throws LockBackendUnavailableError so the runner can fall through", async () => {
        const redis = mock<Redis>();
        redis.set.mockRejectedValue(new Error("fetch failed"));
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
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
        const sysErr = Object.assign(new Error("getaddrinfo ENOTFOUND host"), {
          code: "ENOTFOUND",
        });
        redis.set.mockRejectedValue(sysErr);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 100 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("backend error"),
          expect.objectContaining({
            error: expect.stringContaining("ENOTFOUND"),
            error_name: "Error",
            error_code: "ENOTFOUND",
          }),
        );
      });
    });
  });

  describe("Given the SET call rejects with a non-Error value (string)", () => {
    describe("When acquire is called", () => {
      it("Then still throws LockBackendUnavailableError wrapping the stringified value", async () => {
        const redis = mock<Redis>();
        redis.set.mockRejectedValue("raw-string-err");
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.acquire(ctx(), "k", { ttlMs: 10_000, waitMs: 100 }),
        ).rejects.toBeInstanceOf(LockBackendUnavailableError);
      });
    });
  });

  describe("Given a successfully acquired handle", () => {
    describe("When release is called", () => {
      it("Then invokes eval with the Lua script, [key], [token]", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await handle.release();

        expect(redis.eval).toHaveBeenCalledTimes(1);
        const args = redis.eval.mock.calls[0];
        expect(args?.[0]).toContain('redis.call("GET", KEYS[1])');
        expect(args?.[1]).toEqual(["k"]);
        expect(args?.[2]).toEqual(["tok-1"]);
      });
    });

    describe("When release's Lua eval returns 0 (token mismatch)", () => {
      it("Then logs a warn with 'token mismatch' and increments canonical metric", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockResolvedValue(0 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await handle.release();

        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("token mismatch"),
          expect.objectContaining({ key: "k", token: "tok-1" }),
        );
        const mismatchCalls = logger.incrementCanonical.mock.calls.filter(
          (c) => c[1] === "lock.token_mismatch",
        );
        expect(mismatchCalls).toHaveLength(1);
      });
    });

    describe("When eval rejects with a network error during release", () => {
      it("Then throws LockBackendUnavailableError wrapping the cause", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockRejectedValue(new Error("network down"));
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const handle = await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });
        await expect(handle.release()).rejects.toBeInstanceOf(LockBackendUnavailableError);
      });
    });

    describe("When eval rejects with a non-Error value during release", () => {
      it("Then throws LockBackendUnavailableError wrapping the stringified value", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        redis.eval.mockRejectedValue("bad-release-string");
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
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

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const value = await lock.withLock(
          ctx(),
          "k",
          { ttlMs: 1_000, waitMs: 50 },
          async () => "v",
        );
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

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
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

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        const value = await lock.withLock(
          ctx(),
          "k",
          { ttlMs: 1_000, waitMs: 50 },
          async () => 99,
        );
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

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await lock.withLocks(
          ctx(),
          ["wallet-lock:B", "wallet-lock:A"],
          { ttlMs: 1_000, waitMs: 50 },
          async () => "ok",
        );

        const setKeys = redis.set.mock.calls.map((c) => c[0]);
        expect(setKeys).toEqual(["wallet-lock:A", "wallet-lock:B"]);

        // Eval receives [key] as the keys array — compare first element.
        const evalKeys = redis.eval.mock.calls.map((c) => (c[1] as string[])[0]);
        expect(evalKeys).toEqual(["wallet-lock:B", "wallet-lock:A"]);
      });
    });

    describe("When the second lock in withLocks contends", () => {
      it("Then the first (already-acquired) lock is released and LockContendedError propagates", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValueOnce("OK").mockResolvedValue(null);
        redis.eval.mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await expect(
          lock.withLocks(
            ctx(),
            ["a", "b"],
            { ttlMs: 1_000, waitMs: 20, retryMs: 5 },
            async () => undefined,
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
        redis.eval
          .mockRejectedValueOnce(new Error("release-fail"))
          .mockResolvedValue(1 as unknown as never);
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await lock.withLocks(
          ctx(),
          ["a", "b"],
          { ttlMs: 1_000, waitMs: 50 },
          async () => undefined,
        );

        expect(redis.eval).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });

  describe("Given canonical metrics", () => {
    describe("When acquire succeeds on the first SET", () => {
      it("Then lock.attempts is incremented once", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValue("OK");
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 50 });

        const attemptsCalls = logger.incrementCanonical.mock.calls.filter(
          (c) => c[1] === "lock.attempts",
        );
        expect(attemptsCalls).toHaveLength(1);
        expect(attemptsCalls[0]?.[2]).toBe(1);
      });
    });

    describe("When acquire polls twice before succeeding", () => {
      it("Then lock.attempts is incremented per poll", async () => {
        const redis = mock<Redis>();
        redis.set.mockResolvedValueOnce(null).mockResolvedValueOnce("OK");
        const logger = mock<ILogger>();

        const lock = new UpstashRestDistributedLock(redis, seqIdGen(), logger);
        await lock.acquire(ctx(), "k", { ttlMs: 1_000, waitMs: 200, retryMs: 5 });

        const attemptsCalls = logger.incrementCanonical.mock.calls.filter(
          (c) => c[1] === "lock.attempts",
        );
        expect(attemptsCalls).toHaveLength(2);
      });
    });
  });
});
