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
    "cronSecret",
    "databaseUrl",
    "directUrl",
    "httpPort",
    "logLevel",
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
      delete process.env.REDIS_URL;
    });

    describe("When WALLET_LOCK_ENABLED is unset", () => {
      it("Then walletLock is undefined (feature disabled)", () => {
        const config = loadConfig();
        expect(config.walletLock).toBeUndefined();
      });
    });

    describe("When WALLET_LOCK_ENABLED=true and REDIS_URL is set", () => {
      it("Then walletLock carries the Redis URL and default timings", () => {
        process.env.WALLET_LOCK_ENABLED = "true";
        process.env.REDIS_URL = "redis://localhost:6379";

        const config = loadConfig();
        expect(config.walletLock).toEqual({
          redisUrl: "redis://localhost:6379",
          ttlMs: 10_000,
          waitMs: 5_000,
          retryMs: 50,
        });
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

      it("Then loadConfig throws for WALLET_LOCK_WAIT_MS above 30000", () => {
        process.env.WALLET_LOCK_WAIT_MS = "40000";
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
        process.env.WALLET_LOCK_TTL_MS = "15000";
        process.env.WALLET_LOCK_WAIT_MS = "7000";
        process.env.WALLET_LOCK_RETRY_MS = "100";

        const config = loadConfig();
        expect(config.walletLock).toEqual({
          redisUrl: "redis://localhost:6379",
          ttlMs: 15000,
          waitMs: 7000,
          retryMs: 100,
        });
      });
    });
  });
});
