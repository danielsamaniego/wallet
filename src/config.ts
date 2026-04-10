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

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export function loadConfig(): Config {
  const databaseUrl = getEnv("DATABASE_URL", "postgresql://wallet:wallet@localhost:5432/wallet");
  return {
    databaseUrl,
    directUrl: getEnv("DIRECT_URL", databaseUrl),
    httpPort: Number.parseInt(getEnv("HTTP_PORT", "3000"), 10),
    logLevel: getEnv("LOG_LEVEL", "info"),
    cronSecret: getEnv("CRON_SECRET", ""),
  };
}
