import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Receiver } from "@upstash/qstash";
import { Redis as UpstashRedis } from "@upstash/redis";
import { Redis as IORedis } from "ioredis";
import type { IQStashReceiver } from "./utils/infrastructure/middleware/qstashSignature.js";
import { createAppContext } from "./utils/kernel/context.js";

/**
 * Strips credentials from a redis[s]:// URL for safe logging.
 * Returns "host:port" (+ scheme tag for TLS) or a marker when parsing fails.
 */
function safeRedisHost(url: string): string {
  try {
    const u = new URL(url);
    const tls = u.protocol === "rediss:" ? " (tls)" : "";
    return `${u.hostname}:${u.port || "6379"}${tls}`;
  } catch {
    return "<unparseable-redis-url>";
  }
}

import type { IIdempotencyStore } from "./common/idempotency/application/ports/idempotency.store.js";
import { PrismaIdempotencyStore } from "./common/idempotency/infrastructure/adapters/outbound/prisma/idempotency.store.js";
import type { Config } from "./config.js";
import type {
  ICommand,
  ICommandBus,
  ICommandHandler,
  IQuery,
  IQueryBus,
  IQueryHandler,
} from "./utils/application/cqrs.js";
import type { IDistributedLock } from "./utils/application/distributed.lock.js";
import type { IIDGenerator } from "./utils/application/id.generator.js";
import { LockRunner } from "./utils/application/lock.runner.js";
import type { ITransactionManager } from "./utils/application/transaction.manager.js";
import { connectionRetryExtension } from "./utils/infrastructure/connection.retry.extension.js";
import { CommandBus, QueryBus } from "./utils/infrastructure/cqrs.js";
import { PinoAdapter } from "./utils/infrastructure/observability/pino.adapter.js";
import { SafeLogger } from "./utils/infrastructure/observability/safe.logger.js";
import { SensitiveKeysFilter } from "./utils/infrastructure/observability/sensitive.filter.js";
import { PrismaTransactionManager } from "./utils/infrastructure/prisma.transaction.manager.js";
import { RedisDistributedLock } from "./utils/infrastructure/redis.distributed.lock.js";
import {
  parseUpstashRestCredentials,
  UpstashRestDistributedLock,
} from "./utils/infrastructure/upstash.rest.distributed.lock.js";
import { UUIDV7Generator } from "./utils/infrastructure/uuidV7.js";
import type { ILogger } from "./utils/kernel/observability/logger.port.js";

// ── Module types ───────────────────────────

export interface SharedInfra {
  prisma: PrismaClient;
  logger: ILogger;
  idGen: IIDGenerator;
  txManager: ITransactionManager;
  idempotencyStore: IIdempotencyStore;
  /**
   * Generic per-key distributed lock runner. Use cases inject it to serialize
   * concurrent operations on the same logical resource. When the feature is
   * disabled or the backend is down, the runner falls through transparently.
   */
  lockRunner: LockRunner;
}

export interface CommandRegistration {
  type: string;
  handler: ICommandHandler<ICommand<unknown>, unknown>;
}

export interface QueryRegistration {
  type: string;
  handler: IQueryHandler<IQuery<unknown>, unknown>;
}

export interface ModuleHandlers {
  commands?: CommandRegistration[];
  queries?: QueryRegistration[];
}

import * as CommonModule from "./common/common.module.js";
import * as PlatformModule from "./platform/platform.module.js";
// Modules
import * as WalletModule from "./wallet/wallet.module.js";

/**
 * Dependencies holds all injected dependencies for the API.
 * Infrastructure, repos, and app handlers are wired once here
 * and shared across all route groups.
 */
export interface Dependencies {
  config: Config;
  prisma: PrismaClient;
  idGen: IIDGenerator;
  logger: ILogger;
  idempotencyStore: IIdempotencyStore;
  commandBus: ICommandBus;
  queryBus: IQueryBus;
  /**
   * Receiver for verifying QStash JWT signatures on inbound worker calls.
   * Present only when `config.qstash` is set (both signing keys provided).
   * When absent, the worker route is not mounted.
   */
  qstashReceiver?: IQStashReceiver;
}

const sensitiveKeys = [
  "password",
  "api_key",
  "api_key_hash",
  "secret",
  "token",
  "authorization",
  "cookie",
  "access_token",
  "refresh_token",
];

/** Memoized deps — survives across warm requests in the same serverless instance. */
let _deps: Dependencies | null = null;

/**
 * Wire initializes and wires all dependencies.
 * Logger chain: PinoAdapter -> SensitiveKeysFilter -> SafeLogger
 * Memoized: returns the same instance on subsequent calls within the same process.
 */
export function wire(config: Config): Dependencies {
  if (_deps) return _deps;

  // ── Shared infrastructure ────────────────
  // Order matters: logger + idGen + bootCtx must exist BEFORE Prisma so the
  // connection-retry extension can wire them in and log retry events.
  const idGen = new UUIDV7Generator();
  const rawLogger = new PinoAdapter(config.logLevel);
  const filtered = new SensitiveKeysFilter(rawLogger, sensitiveKeys);
  const logger = new SafeLogger(filtered);
  // `bootCtx` gives wiring-level logs a real trackingId so startup events,
  // Redis connection lifecycle events, and Prisma connection retries are
  // correlatable across the module.
  const bootCtx = createAppContext(idGen);

  // Two transports for Postgres:
  //   - `prisma://` / `prisma+postgres://` → Prisma Accelerate. HTTP transport
  //     to Accelerate's edge; Accelerate maintains the real TCP pool against
  //     the database. Solves serverless cold-start `EMAXCONN` because Vercel
  //     no longer opens TCPs to PgBouncer/Postgres directly.
  //   - everything else → direct TCP via `@prisma/adapter-pg` (Docker locally,
  //     bare Postgres or Supabase pooler in non-Accelerate environments).
  // The `connectionRetryExtension` wraps both so transient errors
  // (EMAXCONN, ECONNRESET, P2024 pool-timeout, P6008 engine-conn) retry
  // transparently before bubbling up as 500.
  const isAccelerate =
    config.databaseUrl.startsWith("prisma://") ||
    config.databaseUrl.startsWith("prisma+postgres://");
  const baseClient = isAccelerate
    ? (new PrismaClient({ accelerateUrl: config.databaseUrl }).$extends(
        withAccelerate(),
      ) as unknown as PrismaClient)
    : new PrismaClient({
        adapter: new PrismaPg({ connectionString: config.databaseUrl }),
      });
  const prisma = baseClient.$extends(
    connectionRetryExtension(logger, bootCtx),
  ) as unknown as PrismaClient;
  logger.info(bootCtx, "prisma client wired", {
    transport: isAccelerate ? "accelerate" : "tcp",
  });
  const txManager = new PrismaTransactionManager(prisma, logger);

  const idempotencyStore = new PrismaIdempotencyStore(prisma, idGen);

  // ── Per-wallet distributed lock (optional) ────────────
  // Built only when WALLET_LOCK_ENABLED=true + REDIS_URL present. When disabled,
  // `distributedLock` is undefined and `lockRunner` falls through transparently
  // — use cases keep working without any serialization. Optimistic locking on
  // Wallet.version remains as a safety net either way.
  let distributedLock: IDistributedLock | undefined;
  const lockOptions = {
    ttlMs: config.walletLock?.ttlMs ?? 10_000,
    waitMs: config.walletLock?.waitMs ?? 5_000,
    retryMs: config.walletLock?.retryMs ?? 50,
  };
  if (config.walletLock) {
    const redisHost = safeRedisHost(config.walletLock.redisUrl);

    if (config.walletLock.transport === "rest") {
      // REST transport: stateless per-request HTTP. Safe for serverless cold
      // bursts where TCP would exhaust the provider's connection quota
      // (Upstash: EMAXCONN at 200/1000 concurrent conns). Credentials come
      // from the same REDIS_URL — host + token are parsed and fed to the
      // @upstash/redis SDK.
      const { url, token } = parseUpstashRestCredentials(config.walletLock.redisUrl);
      const client = new UpstashRedis({ url, token });
      distributedLock = new UpstashRestDistributedLock(client, idGen, logger);
      logger.info(bootCtx, "wallet lock wired", {
        enabled: true,
        transport: "rest",
        redis_host: redisHost,
        ttl_ms: lockOptions.ttlMs,
        wait_ms: lockOptions.waitMs,
        retry_ms: lockOptions.retryMs,
      });
    } else {
      // TCP transport (ioredis). Resilience config: if Redis is unreachable
      // at any point, commands fail FAST so the lock runner falls through.
      //
      //   maxRetriesPerRequest: 1   → one retry per command, then reject
      //   enableOfflineQueue: false → don't buffer commands while disconnected
      //   commandTimeout: 500       → hard cap of 500ms per command
      //   lazyConnect: true         → don't hit Redis at app startup
      const client = new IORedis(config.walletLock.redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        commandTimeout: 500,
        lazyConnect: true,
      });

      // Redis connection lifecycle — surfaces backend availability independent
      // of individual request paths. `error` intentionally goes to warn (not
      // error) because the lock runner is allowed to fall through silently —
      // what matters is that the event is visible, not that it fails the service.
      client.on("connect", () => {
        logger.info(bootCtx, "RedisDistributedLock connect", { redis_host: redisHost });
      });
      client.on("ready", () => {
        logger.info(bootCtx, "RedisDistributedLock ready", { redis_host: redisHost });
      });
      client.on("reconnecting", (delayMs: number) => {
        logger.warn(bootCtx, "RedisDistributedLock reconnecting", {
          redis_host: redisHost,
          delay_ms: delayMs,
        });
      });
      client.on("end", () => {
        logger.warn(bootCtx, "RedisDistributedLock connection ended", { redis_host: redisHost });
      });
      client.on("error", (err: Error) => {
        logger.warn(bootCtx, "RedisDistributedLock client error", {
          redis_host: redisHost,
          error: err.message,
          error_name: err.name,
          ...((err as { code?: unknown }).code !== undefined
            ? { error_code: String((err as { code?: unknown }).code) }
            : {}),
        });
      });

      distributedLock = new RedisDistributedLock(client, idGen, logger);
      logger.info(bootCtx, "wallet lock wired", {
        enabled: true,
        transport: "tcp",
        redis_host: redisHost,
        ttl_ms: lockOptions.ttlMs,
        wait_ms: lockOptions.waitMs,
        retry_ms: lockOptions.retryMs,
      });
    }
  } else {
    logger.info(bootCtx, "wallet lock disabled", {
      enabled: false,
      reason: "WALLET_LOCK_ENABLED=false or REDIS_URL missing",
    });
  }
  const lockRunner = new LockRunner(distributedLock, lockOptions, logger);

  // ── QStash receiver (optional) ────────────────────────────
  // Built only when both signing keys are present. When absent, the worker
  // route at /internal/worker/process-movement is not mounted (returns 404).
  let qstashReceiver: IQStashReceiver | undefined;
  if (config.qstash) {
    qstashReceiver = new Receiver({
      currentSigningKey: config.qstash.currentSigningKey,
      nextSigningKey: config.qstash.nextSigningKey,
    });
    logger.info(bootCtx, "qstash receiver wired", { enabled: true });
  } else {
    logger.info(bootCtx, "qstash receiver disabled", {
      enabled: false,
      reason: "QSTASH_CURRENT_SIGNING_KEY or QSTASH_NEXT_SIGNING_KEY missing",
    });
  }

  const shared = { prisma, logger, idGen, txManager, idempotencyStore, lockRunner };

  // ── Modules ──────────────────────────────
  const wallet = WalletModule.wire(shared);
  const platform = PlatformModule.wire(shared);
  const common = CommonModule.wire(shared);

  // ── Buses ────────────────────────────────
  const commandBus = new CommandBus();
  const queryBus = new QueryBus();

  for (const mod of [wallet, platform, common] as ModuleHandlers[]) {
    for (const c of mod.commands ?? []) commandBus.register(c.type, c.handler);
    for (const q of mod.queries ?? []) queryBus.register(q.type, q.handler);
  }

  _deps = {
    config,
    prisma,
    idGen,
    logger,
    idempotencyStore,
    commandBus,
    queryBus,
    qstashReceiver,
  };

  return _deps;
}
