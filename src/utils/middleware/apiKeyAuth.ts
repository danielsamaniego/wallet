import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../infrastructure/kernel/hono.context.js";
import { errorResponse } from "../infrastructure/kernel/hono.error.js";

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
      return errorResponse(c, "MISSING_API_KEY", "missing X-API-Key header", 401);
    }

    const result = await validateApiKey(apiKey);
    if (!result) {
      return errorResponse(c, "INVALID_API_KEY", "invalid or revoked API key", 401);
    }

    c.set("platformId", result.platformId);
    await next();
  };
}
