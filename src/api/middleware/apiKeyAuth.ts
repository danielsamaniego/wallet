import type { MiddlewareHandler } from "hono";

import type { HonoVariables } from "../../shared/adapters/kernel/hono.context.js";

const API_KEY_HEADER = "x-api-key";

/**
 * Validates API key from X-API-Key header and injects platform_id into context.
 * The validateApiKey function is injected as a dependency — the middleware
 * does not know about the persistence layer.
 */
export function apiKeyAuth(
  validateApiKey: (apiKey: string) => Promise<{ platformId: string } | null>,
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const apiKey = c.req.header(API_KEY_HEADER);
    if (!apiKey) {
      return c.json({ error: "MISSING_API_KEY", message: "missing X-API-Key header" }, 401);
    }

    const result = await validateApiKey(apiKey);
    if (!result) {
      return c.json({ error: "INVALID_API_KEY", message: "invalid or revoked API key" }, 401);
    }

    c.set("platformId", result.platformId);
    await next();
  };
}
