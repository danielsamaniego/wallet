import type { PrismaClient } from "@prisma/client";
import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../hono.context.js";
import { errorResponse } from "../hono.error.js";

const API_KEY_HEADER = "x-api-key";

/**
 * Validates API key from X-API-Key header and injects platform_id into context.
 * Receives PrismaClient and resolves validation internally.
 */
export function apiKeyAuth(prisma: PrismaClient): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const apiKey = c.req.header(API_KEY_HEADER);
    if (!apiKey) {
      return errorResponse(c, "MISSING_API_KEY", "missing X-API-Key header", 401);
    }

    const result = await validateApiKey(prisma, apiKey);
    if (!result) {
      return errorResponse(c, "INVALID_API_KEY", "invalid or revoked API key", 401);
    }

    c.set("platformId", result.platformId);
    c.set("allowNegativeBalance", result.allowNegativeBalance);
    c.set("systemWalletShardCount", result.systemWalletShardCount);
    await next();
  };
}

async function validateApiKey(
  prisma: PrismaClient,
  apiKey: string,
): Promise<{
  platformId: string;
  allowNegativeBalance: boolean;
  systemWalletShardCount: number;
} | null> {
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

  return {
    platformId: platform.id,
    allowNegativeBalance: platform.allowNegativeBalance,
    systemWalletShardCount: platform.systemWalletShardCount,
  };
}
