/**
 * Creates a real Hono app instance wired against the test database.
 * Used by all e2e tests to make authenticated HTTP requests via app.fetch().
 */
import { loadConfig } from "@/config.js";
import { createApp } from "@/app.js";
import { wire } from "@/wiring.js";
import type { Dependencies } from "@/wiring.js";
import {
  TEST_API_KEY,
  ATTACKER_API_KEY,
  truncateAll,
  seedTestPlatform,
  seedAttackerPlatform,
} from "@test/helpers/db.js";

// Force wiring to create a fresh instance for tests
// (the memoization in wiring.ts uses a module-level `_deps` variable)
let _testDeps: Dependencies | null = null;

function getTestDeps(): Dependencies {
  if (!_testDeps) {
    const config = loadConfig();
    _testDeps = wire(config);
  }
  return _testDeps;
}

export interface TestApp {
  /** The raw Hono app for direct app.fetch() calls */
  app: ReturnType<typeof createApp>;
  /** Dependencies for direct Prisma access in assertions */
  deps: Dependencies;
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
  const deps = getTestDeps();
  const app = createApp(deps);

  const makeRequest = (apiKey?: string) => async (path: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...Object.fromEntries(Object.entries(init?.headers ?? {})),
    };
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return app.fetch(
      new Request(`http://localhost${path}`, {
        ...init,
        headers,
      }),
    );
  };

  const reset = async () => {
    await truncateAll();
    await seedTestPlatform();
    await seedAttackerPlatform();
  };

  return {
    app,
    deps,
    request: makeRequest(TEST_API_KEY),
    attackerRequest: makeRequest(ATTACKER_API_KEY),
    unauthenticatedRequest: makeRequest(),
    reset,
  };
}
