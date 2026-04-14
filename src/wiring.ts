import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import type { IIdempotencyStore } from "./common/idempotency/application/ports/idempotency.store.js";
import { PrismaIdempotencyStore } from "./common/idempotency/infrastructure/adapters/outbound/prisma/idempotency.store.js";
import { UUIDV7Generator } from "./utils/infrastructure/uuidV7.js";
import { PinoAdapter } from "./utils/infrastructure/observability/pino.adapter.js";
import { SafeLogger } from "./utils/infrastructure/observability/safe.logger.js";
import { SensitiveKeysFilter } from "./utils/infrastructure/observability/sensitive.filter.js";
import type { IIDGenerator } from "./utils/application/id.generator.js";
import type { ILogger } from "./utils/kernel/observability/logger.port.js";
import type {
  ICommandBus,
  IQueryBus,
  ICommandHandler,
  IQueryHandler,
  ICommand,
  IQuery,
} from "./utils/application/cqrs.js";
import type { ITransactionManager } from "./utils/application/transaction.manager.js";
import { CommandBus, QueryBus } from "./utils/infrastructure/cqrs.js";
import { PrismaTransactionManager } from "./utils/infrastructure/prisma.transaction.manager.js";

// ── Module types ───────────────────────────

export interface SharedInfra {
  prisma: PrismaClient;
  logger: ILogger;
  idGen: IIDGenerator;
  txManager: ITransactionManager;
  idempotencyStore: IIdempotencyStore;
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

// Modules
import * as WalletModule from "./wallet/wallet.module.js";
import * as PlatformModule from "./platform/platform.module.js";
import * as CommonModule from "./common/common.module.js";

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
  const adapter = new PrismaPg({ connectionString: config.databaseUrl });
  const prisma = new PrismaClient({ adapter });
  const idGen = new UUIDV7Generator();
  const rawLogger = new PinoAdapter(config.logLevel);
  const filtered = new SensitiveKeysFilter(rawLogger, sensitiveKeys);
  const logger = new SafeLogger(filtered);
  const txManager = new PrismaTransactionManager(prisma, logger);

  const idempotencyStore = new PrismaIdempotencyStore(prisma, idGen);

  const shared = { prisma, logger, idGen, txManager, idempotencyStore };

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
  };

  return _deps;
}
