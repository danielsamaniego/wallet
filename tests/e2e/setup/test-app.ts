/**
 * Creates a test client that makes real HTTP requests against the running Hono server.
 * The server is started by global-setup.ts on TEST_PORT.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TEST_API_KEY,
  ATTACKER_API_KEY,
  truncateAll,
  seedTestPlatform,
  seedAttackerPlatform,
  getTestPrisma,
} from "@test/helpers/db.js";

const PORT_FILE = resolve(import.meta.dirname, "../../../node_modules/.e2e-port");

function getBaseUrl(): string {
  const port = process.env.TEST_PORT ?? readFileSync(PORT_FILE, "utf-8").trim();
  return `http://localhost:${port}`;
}

export interface TestApp {
  /** Base URL of the running server */
  baseUrl: string;
  /** Prisma client for direct DB assertions */
  prisma: ReturnType<typeof getTestPrisma>;
  /** Make an authenticated request as the test platform */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  /** Make an authenticated request as the attacker platform */
  attackerRequest: (path: string, init?: RequestInit) => Promise<Response>;
  /** Make an unauthenticated request (no API key) */
  unauthenticatedRequest: (path: string, init?: RequestInit) => Promise<Response>;
  /** Reset DB state: truncate all + re-seed both platforms */
  reset: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const baseUrl = getBaseUrl();
  const prisma = getTestPrisma();

  const makeRequest = (apiKey?: string) => async (path: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...Object.fromEntries(Object.entries(init?.headers ?? {})),
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  };

  const reset = async () => {
    await truncateAll();
    await seedTestPlatform();
    await seedAttackerPlatform();
  };

  return {
    baseUrl,
    prisma,
    request: makeRequest(TEST_API_KEY),
    attackerRequest: makeRequest(ATTACKER_API_KEY),
    unauthenticatedRequest: makeRequest(),
    reset,
  };
}
