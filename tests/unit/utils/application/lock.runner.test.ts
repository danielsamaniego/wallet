import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import {
  type IDistributedLock,
  LockBackendUnavailableError,
  LockContendedError,
} from "@/utils/application/distributed.lock.js";
import { LockRunner } from "@/utils/application/lock.runner.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

function ctx(): AppContext {
  return {
    trackingId: "trk",
    startTs: Date.now(),
    canonical: new CanonicalAccumulator(),
  };
}

const defaultOptions = { ttlMs: 1_000, waitMs: 100, retryMs: 50 };

describe("LockRunner", () => {
  describe("Given lock is undefined (feature disabled)", () => {
    describe("When run is called", () => {
      it("Then fn is executed directly without any lock interaction", async () => {
        const logger = mock<ILogger>();
        const runner = new LockRunner(undefined, defaultOptions, logger);
        const fn = vi.fn(async () => "result");

        const value = await runner.run(ctx(), ["any-key"], fn);

        expect(value).toBe("result");
        expect(fn).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("run skipped"),
          expect.objectContaining({ reason: "lock disabled" }),
        );
      });
    });
  });

  describe("Given a lock is provided and the keys are free", () => {
    describe("When run is called", () => {
      it("Then lock.withLocks is called with the keys and fn completes", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockImplementation(async (_ctx, _keys, _opts, fn) => fn());
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        const value = await runner.run(ctx(), ["wallet-lock:w1"], async () => 42);

        expect(value).toBe(42);
        expect(lock.withLocks).toHaveBeenCalledWith(
          expect.anything(),
          ["wallet-lock:w1"],
          defaultOptions,
          expect.any(Function),
        );
        expect(logger.debug).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("run completed"),
          expect.any(Object),
        );
      });
    });
  });

  describe("Given the lock backend is unavailable with a code-bearing cause", () => {
    describe("When run is called", () => {
      it("Then fn falls through and the warn payload includes cause_name/cause_message/cause_code", async () => {
        const lock = mock<IDistributedLock>();
        const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        lock.withLocks.mockRejectedValue(new LockBackendUnavailableError(cause));
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);
        const fn = vi.fn(async () => "fallthrough");

        const value = await runner.run(ctx(), ["k"], fn);

        expect(value).toBe("fallthrough");
        expect(fn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("backend down"),
          expect.objectContaining({
            cause_name: "Error",
            cause_message: expect.stringContaining("ECONNREFUSED"),
            cause_code: "ECONNREFUSED",
          }),
        );
      });
    });
  });

  describe("Given the lock backend is unavailable with a cause but no system code", () => {
    describe("When run is called", () => {
      it("Then the warn payload carries cause_name/cause_message and omits cause_code", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockRejectedValue(
          new LockBackendUnavailableError(new Error("plain error, no code")),
        );
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        await runner.run(ctx(), ["k"], async () => "ok");

        const warnCall = logger.warn.mock.calls.find((c) =>
          typeof c[1] === "string" && c[1].includes("backend down"),
        );
        expect(warnCall?.[2]).toMatchObject({
          cause_name: "Error",
          cause_message: "plain error, no code",
        });
        expect(warnCall?.[2]).not.toHaveProperty("cause_code");
      });
    });
  });

  describe("Given the lock backend is unavailable without a cause", () => {
    describe("When run is called", () => {
      it("Then fn falls through and the warn payload omits cause_* fields", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockRejectedValue(new LockBackendUnavailableError()); // no cause
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        const value = await runner.run(ctx(), ["k"], async () => "ok");

        expect(value).toBe("ok");
        const warnCall = logger.warn.mock.calls.find((c) =>
          typeof c[1] === "string" && c[1].includes("backend down"),
        );
        expect(warnCall).toBeDefined();
        expect(warnCall?.[2]).not.toHaveProperty("cause_name");
        expect(warnCall?.[2]).not.toHaveProperty("cause_code");
      });
    });
  });

  describe("Given the lock is contended beyond waitMs", () => {
    describe("When run is called", () => {
      it("Then it throws AppError.conflict('LOCK_CONTENDED') and fn is NOT executed", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockRejectedValue(new LockContendedError("wallet-lock:hot"));
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);
        const fn = vi.fn();

        try {
          await runner.run(ctx(), ["wallet-lock:hot"], fn);
          throw new Error("expected to throw");
        } catch (err) {
          expect(AppError.is(err)).toBe(true);
          expect((err as AppError).kind).toBe(ErrorKind.Conflict);
          expect((err as AppError).code).toBe("LOCK_CONTENDED");
        }
        expect(fn).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("contended"),
          expect.objectContaining({ key: "wallet-lock:hot" }),
        );
      });
    });
  });

  describe("Given canonical metrics", () => {
    describe("When the run succeeds", () => {
      it("Then increments lock.acquired=1 and lock.duration_ms", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockImplementation(async (_c, _k, _o, fn) => fn());
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        await runner.run(ctx(), ["k"], async () => "ok");

        expect(logger.incrementCanonical).toHaveBeenCalledWith(
          expect.anything(),
          "lock.acquired",
          1,
        );
        const durationCall = logger.incrementCanonical.mock.calls.find(
          (c) => c[1] === "lock.duration_ms",
        );
        expect(durationCall).toBeDefined();
        expect(typeof durationCall?.[2]).toBe("number");
      });
    });

    describe("When the run is contended", () => {
      it("Then increments lock.contended=1 and lock.duration_ms (no lock.acquired)", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockRejectedValue(new LockContendedError("k"));
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        await expect(runner.run(ctx(), ["k"], async () => undefined)).rejects.toBeInstanceOf(
          AppError,
        );

        const keys = logger.incrementCanonical.mock.calls.map((c) => c[1]);
        expect(keys).toContain("lock.contended");
        expect(keys).toContain("lock.duration_ms");
        expect(keys).not.toContain("lock.acquired");
      });
    });

    describe("When the run falls through due to backend down", () => {
      it("Then increments lock.fallthrough=1 and lock.duration_ms (no lock.acquired)", async () => {
        const lock = mock<IDistributedLock>();
        lock.withLocks.mockRejectedValue(new LockBackendUnavailableError(new Error("ECONNREFUSED")));
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        await runner.run(ctx(), ["k"], async () => "ok");

        const keys = logger.incrementCanonical.mock.calls.map((c) => c[1]);
        expect(keys).toContain("lock.fallthrough");
        expect(keys).toContain("lock.duration_ms");
        expect(keys).not.toContain("lock.acquired");
      });
    });

    describe("When the lock is disabled (undefined)", () => {
      it("Then emits NO lock.* metrics — the feature is transparent", async () => {
        const logger = mock<ILogger>();
        const runner = new LockRunner(undefined, defaultOptions, logger);

        await runner.run(ctx(), ["k"], async () => "ok");

        const keys = logger.incrementCanonical.mock.calls.map((c) => c[1]);
        expect(keys.filter((k) => k.startsWith("lock."))).toHaveLength(0);
      });
    });
  });

  describe("Given an unexpected error propagates from the lock call", () => {
    describe("When run is called", () => {
      it("Then the error is re-thrown unchanged", async () => {
        const lock = mock<IDistributedLock>();
        const unexpected = new Error("unexpected-boom");
        lock.withLocks.mockRejectedValue(unexpected);
        const logger = mock<ILogger>();
        const runner = new LockRunner(lock, defaultOptions, logger);

        await expect(
          runner.run(ctx(), ["k"], async () => undefined),
        ).rejects.toThrow("unexpected-boom");
      });
    });
  });
});
