import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { ICommandBus } from "@/utils/application/cqrs.js";
import { updatePlatformConfigRoute } from "@/platform/infrastructure/adapters/inbound/http/updatePlatformConfig/handler.js";

function buildApp(commandBus: ICommandBus) {
  const handlers = updatePlatformConfigRoute(commandBus);
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    c.set("platformId", "platform-1");
    c.set("allowNegativeBalance", false);
    await next();
  });

  app.patch("/config", ...handlers);
  return app;
}

describe("updatePlatformConfigRoute", () => {
  describe("Given a valid request with allow_negative_balance=true", () => {
    it("When PATCH /config is called, Then dispatches UpdatePlatformConfigCommand and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ platformId: "platform-1" }),
      };
      const app = buildApp(commandBus);

      const res = await app.request("/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_negative_balance: true }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.platform_id).toBe("platform-1");
      expect(commandBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  describe("Given a request with an invalid body (missing field)", () => {
    it("When PATCH /config is called, Then returns 400 validation error", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn(),
      };
      const app = buildApp(commandBus);

      const res = await app.request("/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      expect(commandBus.dispatch).not.toHaveBeenCalled();
    });
  });
});
