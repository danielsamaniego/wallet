import { z } from "zod";

/**
 * Zod schema for environment variables.
 * Validates types and constraints at startup — the app refuses to start
 * with missing or malformed configuration.
 */
const configSchema = z.object({
  DATABASE_URL: z.url({ message: "DATABASE_URL must be a valid connection string" }),
  DIRECT_URL: z.url({ message: "DIRECT_URL must be a valid connection string" }).optional(),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CRON_SECRET: z.string().default(""),

  // Distributed lock — per-wallet serialization
  WALLET_LOCK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  WALLET_LOCK_TTL_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  WALLET_LOCK_WAIT_MS: z.coerce.number().int().min(0).max(30_000).default(5_000),
  WALLET_LOCK_RETRY_MS: z.coerce.number().int().min(1).max(1_000).default(50),
  REDIS_URL: z.string().optional(),
});

/**
 * Application configuration loaded from environment variables.
 *
 * `walletLock` is present only when `WALLET_LOCK_ENABLED=true` and
 * `REDIS_URL` is set. When the feature is off, the field is undefined and
 * `wiring` injects a no-op `LockRunner` (lock = undefined) into use cases —
 * they execute their critical section directly, as if the lock did not exist.
 *
 * `REDIS_URL` can point at:
 *   - local Redis (docker-compose):  redis://localhost:6379
 *   - managed Redis (Upstash, etc.): rediss://default:<token>@<host>:<port>
 */
export interface Config {
  databaseUrl: string;
  directUrl: string;
  httpPort: number;
  logLevel: string;
  cronSecret: string;
  walletLock?: {
    redisUrl: string;
    ttlMs: number;
    waitMs: number;
    retryMs: number;
  };
}

/**
 * Parses and validates environment variables via Zod.
 * Throws a descriptive error on invalid or missing configuration.
 */
export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = result.data;

  let walletLock: Config["walletLock"];
  if (env.WALLET_LOCK_ENABLED) {
    if (env.REDIS_URL) {
      walletLock = {
        redisUrl: env.REDIS_URL,
        ttlMs: env.WALLET_LOCK_TTL_MS,
        waitMs: env.WALLET_LOCK_WAIT_MS,
        retryMs: env.WALLET_LOCK_RETRY_MS,
      };
    } else {
      // WALLET_LOCK_ENABLED=true + missing REDIS_URL is effectively the same as
      // the feature being disabled. We surface this to stderr at boot so operators
      // notice a misconfigured env without taking the service down.
      console.warn(
        "[config] WALLET_LOCK_ENABLED=true but REDIS_URL is not set — " +
          "per-wallet lock DISABLED for this process. Set REDIS_URL to enable it.",
      );
    }
  }

  return {
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL ?? env.DATABASE_URL,
    httpPort: env.HTTP_PORT,
    logLevel: env.LOG_LEVEL,
    cronSecret: env.CRON_SECRET,
    walletLock,
  };
}
