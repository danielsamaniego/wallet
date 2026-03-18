import { PrismaClient } from "@prisma/client";

import type { Config } from "./config.js";
import { UUIDV7Generator } from "./shared/kernel/adapters/uuidV7.js";
import type { IDGenerator } from "./shared/kernel/idGenerator.js";
import { PinoAdapter } from "./shared/observability/adapters/pinoAdapter.js";
import type { Logger } from "./shared/observability/logger.js";
import { SafeLogger } from "./shared/observability/safe.js";
import { SensitiveKeysFilter } from "./shared/observability/sensitiveFilter.js";

/**
 * Dependencies holds all injected dependencies for the API.
 */
export interface Dependencies {
  config: Config;
  prisma: PrismaClient;
  idGen: IDGenerator;
  logger: Logger;
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

/**
 * Wire initializes and wires all dependencies.
 * Logger chain: PinoAdapter -> SensitiveKeysFilter -> SafeLogger
 */
export function wire(config: Config): Dependencies {
  // Prisma 7.x reads DATABASE_URL from environment automatically.
  // Connection URL for migrations is configured in prisma/prisma.config.ts.
  const prisma = new PrismaClient();

  const idGen = new UUIDV7Generator();
  const rawLogger = new PinoAdapter(config.logLevel);
  const filtered = new SensitiveKeysFilter(rawLogger, sensitiveKeys);
  const logger = new SafeLogger(filtered);

  return { config, prisma, idGen, logger };
}
