import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { IIdempotencyStore } from "./api/middleware/idempotency.js";
import type { Config } from "./config.js";
import { UUIDV7Generator } from "./shared/adapters/kernel/uuidV7.js";
import { PinoAdapter } from "./shared/adapters/observability/pino.adapter.js";
import { SafeLogger } from "./shared/adapters/observability/safe.logger.js";
import { SensitiveKeysFilter } from "./shared/adapters/observability/sensitive.filter.js";
import type { IIDGenerator } from "./shared/domain/kernel/id.generator.js";
import type { ILogger } from "./shared/domain/observability/logger.port.js";
import { PrismaIdempotencyStore } from "./wallet/adapters/persistence/prisma/idempotency.store.js";

/**
 * Dependencies holds all injected dependencies for the API.
 */
export interface Dependencies {
  config: Config;
  prisma: PrismaClient;
  idGen: IIDGenerator;
  logger: ILogger;
  validateApiKey: (apiKey: string) => Promise<{ platformId: string } | null>;
  idempotencyStore: IIdempotencyStore;
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
  const adapter = new PrismaPg({ connectionString: config.databaseUrl });
  const prisma = new PrismaClient({ adapter });

  const idGen = new UUIDV7Generator();
  const rawLogger = new PinoAdapter(config.logLevel);
  const filtered = new SensitiveKeysFilter(rawLogger, sensitiveKeys);
  const logger = new SafeLogger(filtered);

  const idempotencyStore = new PrismaIdempotencyStore(prisma, idGen);

  const validateApiKey = async (apiKey: string): Promise<{ platformId: string } | null> => {
    // apiKey format: "<api_key_id>.<secret>"
    const dotIndex = apiKey.indexOf(".");
    if (dotIndex === -1) return null;

    const apiKeyId = apiKey.substring(0, dotIndex);
    const secret = apiKey.substring(dotIndex + 1);

    const platform = await prisma.platform.findUnique({
      where: { apiKeyId },
    });

    if (!platform || platform.status !== "active") return null;

    const { createHash, timingSafeEqual } = await import("node:crypto");
    const hash = createHash("sha256").update(secret).digest("hex");
    if (
      hash.length !== platform.apiKeyHash.length ||
      !timingSafeEqual(Buffer.from(hash), Buffer.from(platform.apiKeyHash))
    ) {
      return null;
    }

    return { platformId: platform.id };
  };

  return { config, prisma, idGen, logger, validateApiKey, idempotencyStore };
}
