import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { apiKeyAuth } from "@/utils/infrastructure/middleware/apiKeyAuth.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

function buildApp(prisma: any) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    await next();
  });

  app.use("*", apiKeyAuth(prisma));
  app.get("/test", (c) => c.json({ platformId: c.get("platformId") }));

  return app;
}

describe("apiKeyAuth middleware", () => {
  describe("Given no X-API-Key header", () => {
    it("Then returns 401 MISSING_API_KEY", async () => {
      const prisma = { platform: { findUnique: vi.fn() } };
      const app = buildApp(prisma);

      const res = await app.request("/test");

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("MISSING_API_KEY");
    });
  });

  describe("Given an API key without dot separator", () => {
    it("Then returns 401 INVALID_API_KEY", async () => {
      const prisma = { platform: { findUnique: vi.fn() } };
      const app = buildApp(prisma);

      const res = await app.request("/test", {
        headers: { "x-api-key": "nodot" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_API_KEY");
    });
  });

  describe("Given an API key whose ID does not match any platform", () => {
    it("Then returns 401 INVALID_API_KEY", async () => {
      const prisma = {
        platform: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      const app = buildApp(prisma);

      const res = await app.request("/test", {
        headers: { "x-api-key": "key-id.secret123" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_API_KEY");
    });
  });

  describe("Given a platform that is not active", () => {
    it("Then returns 401 INVALID_API_KEY", async () => {
      const prisma = {
        platform: {
          findUnique: vi.fn().mockResolvedValue({
            id: "plat-1",
            apiKeyId: "key-id",
            apiKeyHash: "wrong",
            status: "suspended",
          }),
        },
      };
      const app = buildApp(prisma);

      const res = await app.request("/test", {
        headers: { "x-api-key": "key-id.secret123" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_API_KEY");
    });
  });

  describe("Given a valid API key with matching hash", () => {
    it("Then sets platformId and proceeds to handler", async () => {
      // Pre-compute the SHA-256 hash of "secret123"
      const { createHash } = await import("node:crypto");
      const secretHash = createHash("sha256").update("secret123").digest("hex");

      const prisma = {
        platform: {
          findUnique: vi.fn().mockResolvedValue({
            id: "plat-1",
            apiKeyId: "key-id",
            apiKeyHash: secretHash,
            status: "active",
          }),
        },
      };
      const app = buildApp(prisma);

      const res = await app.request("/test", {
        headers: { "x-api-key": "key-id.secret123" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.platformId).toBe("plat-1");
    });
  });

  describe("Given a valid API key but wrong secret (hash mismatch)", () => {
    it("Then returns 401 INVALID_API_KEY", async () => {
      const prisma = {
        platform: {
          findUnique: vi.fn().mockResolvedValue({
            id: "plat-1",
            apiKeyId: "key-id",
            apiKeyHash: "0".repeat(64), // 64-char hex string that won't match
            status: "active",
          }),
        },
      };
      const app = buildApp(prisma);

      const res = await app.request("/test", {
        headers: { "x-api-key": "key-id.wrongsecret" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_API_KEY");
    });
  });
});
