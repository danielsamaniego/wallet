import { describe, expect, it } from "vitest";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import {
  connectionRetryExtension,
  createAllOperationsHandler,
  isConnectionError,
  retryOnConnectionError,
} from "@/utils/infrastructure/connection.retry.extension.js";
import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";

function ctx(): AppContext {
  return {
    trackingId: "trk-retry",
    startTs: Date.now(),
    canonical: new CanonicalAccumulator(),
  };
}

describe("isConnectionError", () => {
  describe("Given an EMAXCONN error from PgBouncer", () => {
    describe("When classified", () => {
      it("Then returns true", () => {
        const err = new Error("(EMAXCONN) max client connections reached, limit: 200");
        expect(isConnectionError(err)).toBe(true);
      });
    });
  });

  describe("Given a generic 'too many clients' error from Postgres", () => {
    describe("When classified", () => {
      it("Then returns true", () => {
        expect(isConnectionError(new Error("FATAL: too many clients already"))).toBe(true);
      });
    });
  });

  describe("Given a socket-level error (ECONNRESET, ECONNREFUSED, ETIMEDOUT, connection terminated)", () => {
    describe("When classified", () => {
      it("Then returns true for every variant", () => {
        expect(isConnectionError(new Error("ECONNRESET on pg socket"))).toBe(true);
        expect(isConnectionError(new Error("Error: ECONNREFUSED 1.2.3.4:6543"))).toBe(true);
        expect(isConnectionError(new Error("ETIMEDOUT while acquiring connection"))).toBe(true);
        expect(isConnectionError(new Error("connection terminated unexpectedly"))).toBe(true);
        expect(isConnectionError(new Error("connection refused by server"))).toBe(true);
      });
    });
  });

  describe("Given a VERSION_CONFLICT domain error", () => {
    describe("When classified", () => {
      it("Then returns false (not a connection error — TransactionManager owns it)", () => {
        expect(isConnectionError(new Error("VERSION_CONFLICT: wallet version stale"))).toBe(false);
      });
    });
  });

  describe("Given a unique constraint violation", () => {
    describe("When classified", () => {
      it("Then returns false (domain concern, do not retry)", () => {
        expect(
          isConnectionError(new Error("duplicate key value violates unique constraint")),
        ).toBe(false);
      });
    });
  });

  describe("Given a non-Error value (string, null, undefined, object)", () => {
    describe("When classified", () => {
      it("Then returns false without throwing", () => {
        expect(isConnectionError("EMAXCONN string literal")).toBe(false);
        expect(isConnectionError(null)).toBe(false);
        expect(isConnectionError(undefined)).toBe(false);
        expect(isConnectionError({ message: "EMAXCONN" })).toBe(false);
      });
    });
  });
});

describe("retryOnConnectionError", () => {
  describe("Given a function that succeeds on the first attempt", () => {
    describe("When invoked", () => {
      it("Then returns the result without any retry or logging", async () => {
        const logger = createMockLogger();
        let calls = 0;
        const result = await retryOnConnectionError(
          async () => {
            calls++;
            return "ok";
          },
          { logger, ctx: ctx(), baseDelayMs: 0, jitterMs: 0, random: () => 0 },
        );
        expect(result).toBe("ok");
        expect(calls).toBe(1);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.incrementCanonical).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given a function that fails twice with EMAXCONN then succeeds", () => {
    describe("When invoked", () => {
      it("Then retries with exponential backoff and returns the final result", async () => {
        const logger = createMockLogger();
        let calls = 0;
        const result = await retryOnConnectionError(
          async () => {
            calls++;
            if (calls < 3) throw new Error("(EMAXCONN) max client connections reached, limit: 200");
            return "recovered";
          },
          {
            logger,
            ctx: ctx(),
            baseDelayMs: 0,
            jitterMs: 0,
            random: () => 0,
            operation: "findUnique",
            model: "Wallet",
          },
        );
        expect(result).toBe("recovered");
        expect(calls).toBe(3);
        // Two retry warnings (before attempts 2 and 3). The third attempt succeeds so no more.
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.incrementCanonical).toHaveBeenCalledWith(
          expect.anything(),
          "prisma.connection_retries",
          1,
        );
      });
    });
  });

  describe("Given a function that always fails with EMAXCONN", () => {
    describe("When invoked with the default 8 attempts", () => {
      it("Then throws the original error after exhausting all retries", async () => {
        const logger = createMockLogger();
        let calls = 0;
        await expect(
          retryOnConnectionError(
            async () => {
              calls++;
              throw new Error("(EMAXCONN) max client connections reached, limit: 200");
            },
            { logger, ctx: ctx(), baseDelayMs: 0, jitterMs: 0, random: () => 0 },
          ),
        ).rejects.toThrow(/EMAXCONN/);
        expect(calls).toBe(8);
        // 7 warnings (before attempts 2..8). The last attempt has no subsequent warning.
        expect(logger.warn).toHaveBeenCalledTimes(7);
      });
    });
  });

  describe("Given an exponential schedule with a delay cap", () => {
    describe("When the function fails repeatedly", () => {
      it("Then caps individual sleeps at maxDelayMs so the budget stays bounded", async () => {
        const logger = createMockLogger();
        const delays: number[] = [];
        const capturingLogger: ILogger = {
          ...logger,
          warn: (c: AppContext, msg: string, extras?: Record<string, unknown>) => {
            if (extras && typeof extras.next_delay_ms === "number") {
              delays.push(extras.next_delay_ms);
            }
            logger.warn(c, msg, extras);
          },
        };
        // Values scaled 100x down from production defaults (base=200→2,
        // cap=2000→20) to keep the test under a second in real time while
        // exercising the same capping behaviour.
        await expect(
          retryOnConnectionError(
            async () => {
              throw new Error("EMAXCONN");
            },
            {
              logger: capturingLogger,
              ctx: ctx(),
              baseDelayMs: 2,
              maxDelayMs: 20,
              jitterMs: 0,
              random: () => 0,
            },
          ),
        ).rejects.toThrow(/EMAXCONN/);
        // 7 logged delays between 8 attempts. Sequence with base=2, cap=20:
        // 2, 4, 8, 16, 20, 20, 20 — the last three hit the cap.
        expect(delays).toEqual([2, 4, 8, 16, 20, 20, 20]);
      });
    });
  });

  describe("Given a function that throws a non-connection error", () => {
    describe("When invoked", () => {
      it("Then re-throws immediately without retrying", async () => {
        const logger = createMockLogger();
        let calls = 0;
        await expect(
          retryOnConnectionError(
            async () => {
              calls++;
              throw new Error("VERSION_CONFLICT");
            },
            { logger, ctx: ctx(), baseDelayMs: 0, jitterMs: 0, random: () => 0 },
          ),
        ).rejects.toThrow("VERSION_CONFLICT");
        expect(calls).toBe(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("Given custom retry options (maxAttempts=2, baseDelayMs=50, jitterMs=20)", () => {
    describe("When the function fails once then succeeds", () => {
      it("Then respects the custom budget and produces a jittered delay", async () => {
        const logger = createMockLogger();
        let calls = 0;
        const result = await retryOnConnectionError(
          async () => {
            calls++;
            if (calls < 2) throw new Error("ECONNRESET");
            return 42;
          },
          {
            logger,
            ctx: ctx(),
            maxAttempts: 2,
            baseDelayMs: 50,
            jitterMs: 20,
            random: () => 0.5,
          },
        );
        expect(result).toBe(42);
        expect(calls).toBe(2);
        // Attempt-1 delay: 50 * 2^0 + 0.5 * 20 = 60ms. Logged with attempt=1.
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("retrying"),
          expect.objectContaining({ attempt: 1, next_delay_ms: 60 }),
        );
      });
    });
  });

  describe("Given no logger/ctx is provided", () => {
    describe("When retrying a connection error", () => {
      it("Then still retries but emits no logs or metrics", async () => {
        let calls = 0;
        const result = await retryOnConnectionError(
          async () => {
            calls++;
            if (calls < 2) throw new Error("connection terminated unexpectedly");
            return "ok";
          },
          { baseDelayMs: 0, jitterMs: 0, random: () => 0 },
        );
        expect(result).toBe("ok");
        expect(calls).toBe(2);
      });
    });
  });
});

describe("createAllOperationsHandler", () => {
  describe("Given the handler is built with logger + bootCtx", () => {
    describe("When the underlying query fails with EMAXCONN then succeeds", () => {
      it("Then retries transparently and returns the successful result", async () => {
        const logger = createMockLogger();
        const handler = createAllOperationsHandler(logger, ctx());

        let attempts = 0;
        const query = async (_args: unknown) => {
          attempts++;
          if (attempts < 3) {
            throw new Error("(EMAXCONN) max client connections reached, limit: 200");
          }
          return { id: "wallet-1" };
        };

        const result = await handler({
          args: { where: { id: "wallet-1" } },
          query,
          operation: "findUnique",
          model: "Wallet",
        });

        expect(result).toEqual({ id: "wallet-1" });
        expect(attempts).toBe(3);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("retrying"),
          expect.objectContaining({ operation: "findUnique", model: "Wallet" }),
        );
      });
    });

    describe("When the underlying query fails with a non-connection error", () => {
      it("Then the handler propagates the error without retrying", async () => {
        const logger = createMockLogger();
        const handler = createAllOperationsHandler(logger, ctx());

        let attempts = 0;
        const query = async (_args: unknown) => {
          attempts++;
          throw new Error("Unique constraint failed on wallets_owner_idx");
        };

        await expect(
          handler({
            args: {},
            query,
            operation: "create",
            model: "Wallet",
          }),
        ).rejects.toThrow(/Unique constraint/);
        expect(attempts).toBe(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    describe("When invoked without a model (e.g. raw query operations)", () => {
      it("Then still retries without error", async () => {
        const logger = createMockLogger();
        const handler = createAllOperationsHandler(logger, ctx());

        let attempts = 0;
        const query = async (_args: unknown) => {
          attempts++;
          if (attempts < 2) throw new Error("ECONNRESET");
          return ["row"];
        };

        const result = await handler({
          args: {},
          query,
          operation: "$queryRaw",
        });
        expect(result).toEqual(["row"]);
        expect(attempts).toBe(2);
      });
    });
  });
});

describe("connectionRetryExtension", () => {
  describe("Given the factory is called with a logger and bootCtx", () => {
    describe("When invoked", () => {
      it("Then returns a Prisma extension value that can be passed to $extends", () => {
        const extension = connectionRetryExtension(createMockLogger(), ctx());
        // Prisma.defineExtension returns a callable at runtime (the extension
        // is applied lazily when $extends is called). Guarantee only the
        // public contract: a truthy, non-null value consumable by $extends.
        expect(extension).toBeDefined();
        expect(extension).not.toBeNull();
      });
    });
  });
});
