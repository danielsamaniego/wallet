/**
 * Application configuration from environment variables.
 * Application configuration loaded from environment variables.
 */
export interface Config {
  databaseUrl: string;
  httpPort: number;
  logLevel: string;
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export function loadConfig(): Config {
  return {
    databaseUrl: getEnv("DATABASE_URL", "postgresql://wallet:wallet@localhost:5432/wallet"),
    httpPort: Number.parseInt(getEnv("HTTP_PORT", "3000"), 10),
    logLevel: getEnv("LOG_LEVEL", "info"),
  };
}
