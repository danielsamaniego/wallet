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
  // TTL must exceed Vercel `maxDuration` so the lock cannot expire while
  // the function is still alive (the original 60s ceiling broke that
  // invariant: with maxDuration=55s a body that took >60s left the lock
  // free for another Lambda to grab — 345 token_mismatch events in the
  // load test). Capped at 10 min as a sanity bound for any future plan.
  WALLET_LOCK_TTL_MS: z.coerce.number().int().min(100).max(600_000).default(10_000),
  // Wait should stay well under TTL — see boot-time invariant check below.
  WALLET_LOCK_WAIT_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
  WALLET_LOCK_RETRY_MS: z.coerce.number().int().min(1).max(1_000).default(50),
  // Transport for the distributed lock. Default `tcp` uses ioredis against
  // `REDIS_URL`. `rest` uses @upstash/redis over HTTPS — stateless per-request,
  // ideal for serverless where cold starts would otherwise exhaust the
  // provider's connection quota (Upstash: `EMAXCONN` at 200/1000 conns). Both
  // transports read credentials from the same `REDIS_URL`; REST parses out the
  // host + token and builds an HTTPS URL for the Upstash proxy.
  WALLET_LOCK_TRANSPORT: z.enum(["tcp", "rest"]).default("tcp"),
  REDIS_URL: z.string().optional(),

  // QStash — async movement processing pipeline (Phase 1C+).
  // Signing keys are public dev defaults in docker-compose.dev.yml; production
  // sets them to the values from console.upstash.com/qstash. When either key
  // is missing, the worker route is NOT mounted (returns 404).
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
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
    transport: "tcp" | "rest";
    ttlMs: number;
    waitMs: number;
    retryMs: number;
  };
  /**
   * QStash signing keys. Present only when BOTH keys are set on the env.
   * The worker route at `/internal/worker/process-movement` mounts only
   * when this is present; otherwise it returns 404 so unconfigured
   * environments cannot accept signed deliveries by accident.
   */
  qstash?: {
    currentSigningKey: string;
    nextSigningKey: string;
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
      // Boot-time invariants on lock timings.
      // wait_ms < ttl_ms is essential: if a request waits longer than
      // the TTL, the lock it eventually grabs may already have expired,
      // defeating mutual exclusion. We require a 2x margin to absorb
      // jitter (acquire latency, GC pauses, retry intervals) without
      // tripping the invariant in degenerate cases.
      if (env.WALLET_LOCK_WAIT_MS * 2 > env.WALLET_LOCK_TTL_MS) {
        throw new Error(
          `Invalid lock configuration: WALLET_LOCK_WAIT_MS (${env.WALLET_LOCK_WAIT_MS}ms) ` +
            `* 2 exceeds WALLET_LOCK_TTL_MS (${env.WALLET_LOCK_TTL_MS}ms). ` +
            `TTL must comfortably exceed wait time so a lock cannot expire while another ` +
            `request is still waiting to acquire it. Recommend ttl >= 2 * wait.`,
        );
      }
      // TTL must exceed Vercel's maxDuration so the lock outlives any
      // function instance that holds it. We cannot read maxDuration
      // from the runtime environment, so we warn loudly when TTL drops
      // below a sensible serverless floor (30s = below maxDuration of
      // even small Vercel plans). Operators must keep TTL > maxDuration
      // every time maxDuration is changed in vercel.json.
      if (env.WALLET_LOCK_TTL_MS < 30_000) {
        console.warn(
          `[config] WALLET_LOCK_TTL_MS=${env.WALLET_LOCK_TTL_MS}ms is below the 30s ` +
            `floor recommended for serverless deployments. Vercel maxDuration is currently ` +
            `55s in vercel.json — TTL must exceed it (recommend >= 90000ms) to prevent ` +
            `lock expiry while a function is still alive.`,
        );
      }
      walletLock = {
        redisUrl: env.REDIS_URL,
        transport: env.WALLET_LOCK_TRANSPORT,
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

  let qstash: Config["qstash"];
  if (env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY) {
    qstash = {
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    };
  }

  return {
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL ?? env.DATABASE_URL,
    httpPort: env.HTTP_PORT,
    logLevel: env.LOG_LEVEL,
    cronSecret: env.CRON_SECRET,
    walletLock,
    qstash,
  };
}
