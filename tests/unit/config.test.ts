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
});
