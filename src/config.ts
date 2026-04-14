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
});

/**
 * Application configuration loaded from environment variables.
 */
export interface Config {
  databaseUrl: string;
  directUrl: string;
  httpPort: number;
  logLevel: string;
  cronSecret: string;
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
  return {
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL ?? env.DATABASE_URL,
    httpPort: env.HTTP_PORT,
    logLevel: env.LOG_LEVEL,
    cronSecret: env.CRON_SECRET,
  };
}
