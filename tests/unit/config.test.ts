import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "@/config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * GUARDIAN TEST — ensures every Config property is covered by tests.
   *
   * If you add a new field to Config, this test fails until you add it
   * to the expected list below AND write validation tests for it.
   */
  const EXPECTED_CONFIG_KEYS = [
    "asyncPipeline",
    "asyncProcessingEnabled",
    "cronSecret",
    "databaseUrl",
    "directUrl",
    "httpPort",
    "logLevel",
    "qstash",
    "walletLock",
  ];

  describe("Given a valid configuration", () => {
    describe("When loadConfig returns", () => {
      it("Then the returned object has EXACTLY the expected keys — no more, no less", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

        const config = loadConfig();

        expect(Object.keys(config).sort()).toEqual(EXPECTED_CONFIG_KEYS);
      });
    });
  });

  // ── valid configuration ───────────────────────────────────────────

  describe("Given valid environment variables", () => {
    describe("When all vars are set", () => {
      it("Then returns parsed config with correct values", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        process.env.DIRECT_URL = "postgresql://user:pass@localhost:5432/db_direct";
        process.env.HTTP_PORT = "4000";
        process.env.LOG_LEVEL = "debug";
        process.env.CRON_SECRET = "my-secret";

        const config = loadConfig();

        expect(config.databaseUrl).toBe("postgresql://user:pass@localhost:5432/db");
        expect(config.directUrl).toBe("postgresql://user:pass@localhost:5432/db_direct");
        expect(config.httpPort).toBe(4000);
        expect(config.logLevel).toBe("debug");
        expect(config.cronSecret).toBe("my-secret");
      });
    });

    describe("When only DATABASE_URL is set", () => {
      it("Then uses defaults for optional vars and DIRECT_URL falls back to DATABASE_URL", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        delete process.env.DIRECT_URL;
        delete process.env.HTTP_PORT;
        delete process.env.LOG_LEVEL;
        delete process.env.CRON_SECRET;

        const config = loadConfig();

        expect(config.databaseUrl).toBe("postgresql://user:pass@localhost:5432/db");
        expect(config.directUrl).toBe("postgresql://user:pass@localhost:5432/db");
        expect(config.httpPort).toBe(3000);
        expect(config.logLevel).toBe("info");
        expect(config.cronSecret).toBe("");
      });
    });
  });

  // ── missing required vars ─────────────────────────────────────────

  describe("Given missing required environment variables", () => {
    describe("When DATABASE_URL is not set", () => {
      it("Then throws a descriptive error mentioning the variable", () => {
        delete process.env.DATABASE_URL;

        expect(() => loadConfig()).toThrow("Invalid environment configuration");
        expect(() => loadConfig()).toThrow("DATABASE_URL");
      });
    });
  });

  // ── invalid values per variable ───────────────────────────────────

  describe("Given invalid DATABASE_URL", () => {
    it("Then throws when value is not a valid URL", () => {
      process.env.DATABASE_URL = "not-a-url";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });
  });

  describe("Given invalid DIRECT_URL", () => {
    it("Then throws when value is not a valid URL", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.DIRECT_URL = "not-a-url";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });
  });

  describe("Given invalid HTTP_PORT", () => {
    it("Then throws when value is not a number", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.HTTP_PORT = "abc";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });

    it("Then throws for port 0", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.HTTP_PORT = "0";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });

    it("Then throws for port above 65535", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.HTTP_PORT = "70000";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });
  });

  describe("Given invalid LOG_LEVEL", () => {
    it("Then throws when value is not a valid Pino level", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.LOG_LEVEL = "verbose";

      expect(() => loadConfig()).toThrow("Invalid environment configuration");
    });
  });

  // ── walletLock ───────────────────────────────────────────────────

  describe("Given walletLock configuration", () => {
    beforeEach(() => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      delete process.env.WALLET_LOCK_ENABLED;
      delete process.env.WALLET_LOCK_TTL_MS;
      delete process.env.WALLET_LOCK_WAIT_MS;
      delete process.env.WALLET_LOCK_RETRY_MS;
      delete process.env.WALLET_LOCK_TRANSPORT;
      delete process.env.REDIS_URL;
    });

    describe("When WALLET_LOCK_ENABLED is unset", () => {
      it("Then walletLock is undefined (feature disabled)", () => {
        const config = loadConfig();
        expect(config.walletLock).toBeUndefined();
      });
    });

    describe("When WALLET_LOCK_ENABLED=true and REDIS_URL is set", () => {
      it("Then walletLock carries the Redis URL, default tcp transport, and default timings", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";

        const config = loadConfig();
        expect(config.walletLock).toEqual({
          redisUrl: "redis://localhost:6379",
          transport: "tcp",
          ttlMs: 10_000,
          waitMs: 5_000,
          retryMs: 50,
        });
      });
    });

    describe("When WALLET_LOCK_TRANSPORT=rest is set", () => {
      it("Then walletLock.transport is 'rest' (enables the HTTP adapter)", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "rediss://default:secret@hostname.upstash.io:6379";
        process.env.WALLET_LOCK_TRANSPORT = "rest";

        const config = loadConfig();
        expect(config.walletLock?.transport).toBe("rest");
      });
    });

    describe("When WALLET_LOCK_TRANSPORT has an unsupported value", () => {
      it("Then loadConfig throws (zod enum rejects it at startup)", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";
        process.env.WALLET_LOCK_TRANSPORT = "grpc";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });
    });

    describe("When WALLET_LOCK_ENABLED=true with a managed Redis TCP URL (rediss://)", () => {
      it("Then walletLock preserves the full connection string", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "rediss://default:secret@hostname.upstash.io:6379";

        const config = loadConfig();
        expect(config.walletLock?.redisUrl).toBe(
          "rediss://default:secret@hostname.upstash.io:6379",
        );
      });
    });

    describe("When WALLET_LOCK_ENABLED=true but REDIS_URL is missing", () => {
      it("Then walletLock is undefined (feature disabled) and a warning is emitted to stderr", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          const config = loadConfig();
          expect(config.walletLock).toBeUndefined();
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("WALLET_LOCK_ENABLED=true but REDIS_URL is not set"),
          );
        } finally {
          warnSpy.mockRestore();
        }
      });
    });

    describe("When timing parameters are out of range", () => {
      it("Then loadConfig throws for invalid WALLET_LOCK_TTL_MS", () => {
        process.env.WALLET_LOCK_TTL_MS = "10";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });

      it("Then loadConfig throws for WALLET_LOCK_WAIT_MS above 60000", () => {
        process.env.WALLET_LOCK_WAIT_MS = "70000";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });

      it("Then loadConfig throws for WALLET_LOCK_TTL_MS above 600000", () => {
        process.env.WALLET_LOCK_TTL_MS = "700000";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });

      it("Then loadConfig throws for WALLET_LOCK_RETRY_MS below 1", () => {
        process.env.WALLET_LOCK_RETRY_MS = "0";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });
    });

    describe("When WALLET_LOCK_ENABLED has an invalid value", () => {
      it("Then loadConfig throws", () => {
        process.env.WALLET_LOCK_ENABLED = "yes";
        expect(() => loadConfig()).toThrow("Invalid environment configuration");
      });
    });

    describe("When enabled and timing params are provided", () => {
      it("Then they override the defaults", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";
        process.env.WALLET_LOCK_TTL_MS = "90000";
        process.env.WALLET_LOCK_WAIT_MS = "5000";
        process.env.WALLET_LOCK_RETRY_MS = "100";

        const config = loadConfig();
        expect(config.walletLock).toEqual({
          redisUrl: "redis://localhost:6379",
          transport: "tcp",
          ttlMs: 90000,
          waitMs: 5000,
          retryMs: 100,
        });
      });
    });

    describe("Boot-time invariants on lock timings", () => {
      it("Given wait_ms*2 exceeds ttl_ms, When loadConfig runs, Then throws so the lock cannot expire mid-acquire", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";
        process.env.WALLET_LOCK_TTL_MS = "10000";
        process.env.WALLET_LOCK_WAIT_MS = "8000"; // 8000 * 2 = 16000 > 10000

        expect(() => loadConfig()).toThrow(/2 exceeds WALLET_LOCK_TTL_MS/);
      });

      it("Given ttl_ms below 30s floor, When loadConfig runs, Then logs a warn but does not throw", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";
        process.env.WALLET_LOCK_TTL_MS = "20000";
        process.env.WALLET_LOCK_WAIT_MS = "5000";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          loadConfig();
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("below the 30s"),
          );
        } finally {
          warnSpy.mockRestore();
        }
      });

      it("Given a healthy serverless config (TTL=90s, wait=5s), When loadConfig runs, Then no warn or throw", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";
        process.env.WALLET_LOCK_TTL_MS = "90000";
        process.env.WALLET_LOCK_WAIT_MS = "5000";
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          expect(() => loadConfig()).not.toThrow();
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
        }
      });
    });
  });

  // ── QStash signing keys (async movement processing) ──────────────

  describe("QStash signing keys", () => {
    describe("Given neither signing key is set", () => {
      it("Then config.qstash is undefined and the worker route stays unmounted", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        delete process.env.QSTASH_CURRENT_SIGNING_KEY;
        delete process.env.QSTASH_NEXT_SIGNING_KEY;

        const config = loadConfig();

        expect(config.qstash).toBeUndefined();
      });
    });

    describe("Given only QSTASH_CURRENT_SIGNING_KEY is set", () => {
      it("Then config.qstash is undefined — both keys are required together", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_current";
        delete process.env.QSTASH_NEXT_SIGNING_KEY;

        const config = loadConfig();

        expect(config.qstash).toBeUndefined();
      });
    });

    describe("Given only QSTASH_NEXT_SIGNING_KEY is set", () => {
      it("Then config.qstash is undefined — both keys are required together", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        delete process.env.QSTASH_CURRENT_SIGNING_KEY;
        process.env.QSTASH_NEXT_SIGNING_KEY = "sig_next";

        const config = loadConfig();

        expect(config.qstash).toBeUndefined();
      });
    });

    describe("Given both QSTASH signing keys are set", () => {
      it("Then config.qstash carries both verbatim", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_current_real";
        process.env.QSTASH_NEXT_SIGNING_KEY = "sig_next_real";

        const config = loadConfig();

        expect(config.qstash).toEqual({
          currentSigningKey: "sig_current_real",
          nextSigningKey: "sig_next_real",
        });
      });
    });
  });

  // ── Async pipeline outbound (Phase 2B.5+) ─────────────────────────

  describe("Async pipeline outbound configuration", () => {
    describe("Given none of QSTASH_TOKEN, QSTASH_URL, WALLET_INTERNAL_WORKER_URL is set", () => {
      it("Then config.asyncPipeline is undefined and the enqueue use case stays unregistered", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        delete process.env.QSTASH_TOKEN;
        delete process.env.QSTASH_URL;
        delete process.env.WALLET_INTERNAL_WORKER_URL;

        const config = loadConfig();

        expect(config.asyncPipeline).toBeUndefined();
      });
    });

    describe.each([
      ["QSTASH_TOKEN", { url: "http://x", worker: "http://x" }],
      ["QSTASH_URL", { token: "tk", worker: "http://x" }],
      ["WALLET_INTERNAL_WORKER_URL", { token: "tk", url: "http://x" }],
    ])(
      "Given %s alone is missing",
      (_label, present: { token?: string; url?: string; worker?: string }) => {
        it("Then config.asyncPipeline stays undefined — all three fields are required together", () => {
          process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
          if (present.token) process.env.QSTASH_TOKEN = present.token;
          else delete process.env.QSTASH_TOKEN;
          if (present.url) process.env.QSTASH_URL = present.url;
          else delete process.env.QSTASH_URL;
          if (present.worker) process.env.WALLET_INTERNAL_WORKER_URL = present.worker;
          else delete process.env.WALLET_INTERNAL_WORKER_URL;

          const config = loadConfig();

          expect(config.asyncPipeline).toBeUndefined();
        });
      },
    );

    describe("Given all three required fields are set", () => {
      it("Then config.asyncPipeline carries them along with defaults for queueName and handlerWaitMs", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        process.env.QSTASH_TOKEN = "tk_real";
        process.env.QSTASH_URL = "https://qstash.upstash.io";
        process.env.WALLET_INTERNAL_WORKER_URL =
          "https://wallet.example.com/internal/worker/process-movement";
        delete process.env.WALLET_QSTASH_QUEUE_NAME;
        delete process.env.WALLET_HANDLER_WAIT_MS;

        const config = loadConfig();

        expect(config.asyncPipeline).toEqual({
          qstashToken: "tk_real",
          qstashUrl: "https://qstash.upstash.io",
          queueName: "wallet-movements",
          workerUrl: "https://wallet.example.com/internal/worker/process-movement",
          handlerWaitMs: 1500,
        });
      });
    });

    describe("Given a custom queueName and handlerWaitMs", () => {
      it("Then config.asyncPipeline reflects the overrides", () => {
        process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
        process.env.QSTASH_TOKEN = "tk_real";
        process.env.QSTASH_URL = "https://qstash.upstash.io";
        process.env.WALLET_INTERNAL_WORKER_URL = "https://wallet.example.com/w";
        process.env.WALLET_QSTASH_QUEUE_NAME = "wallet-movements-eu";
        process.env.WALLET_HANDLER_WAIT_MS = "3000";

        const config = loadConfig();

        expect(config.asyncPipeline!.queueName).toBe("wallet-movements-eu");
        expect(config.asyncPipeline!.handlerWaitMs).toBe(3000);
      });
    });
  });

  // ── asyncProcessingEnabled flag ───────────────────────────────

  describe("Given WALLET_ASYNC_PROCESSING_ENABLED is not set", () => {
    it("Then config.asyncProcessingEnabled is false (handlers stay on the sync path by default)", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

      const config = loadConfig();

      expect(config.asyncProcessingEnabled).toBe(false);
    });
  });

  describe("Given WALLET_ASYNC_PROCESSING_ENABLED is set to a non-boolean string", () => {
    it("Then loadConfig throws — the env contract is strict 'true'/'false' so a typo cannot silently disable rollout", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.WALLET_ASYNC_PROCESSING_ENABLED = "yes";

      expect(() => loadConfig()).toThrow(/WALLET_ASYNC_PROCESSING_ENABLED/);
    });
  });

  describe("Given WALLET_ASYNC_PROCESSING_ENABLED=true", () => {
    it("Then config.asyncProcessingEnabled is the boolean true (string coerced to bool)", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.WALLET_ASYNC_PROCESSING_ENABLED = "true";

      const config = loadConfig();

      expect(config.asyncProcessingEnabled).toBe(true);
    });

    it("Then the flag is independent of asyncPipeline wiring — a deployment can flip the flag before publisher env vars are set, and handlers gracefully degrade at runtime", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.WALLET_ASYNC_PROCESSING_ENABLED = "true";
      delete process.env.QSTASH_TOKEN;
      delete process.env.QSTASH_URL;
      delete process.env.WALLET_INTERNAL_WORKER_URL;

      const config = loadConfig();

      expect(config.asyncProcessingEnabled).toBe(true);
      expect(config.asyncPipeline).toBeUndefined();
    });
  });

  describe("Given WALLET_ASYNC_PROCESSING_ENABLED=false explicitly", () => {
    it("Then config.asyncProcessingEnabled is false", () => {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      process.env.WALLET_ASYNC_PROCESSING_ENABLED = "false";

      const config = loadConfig();

      expect(config.asyncProcessingEnabled).toBe(false);
    });
  });
});
