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
    c.set("systemWalletShardCount", 32);
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

  describe("Given a request with an empty body (all fields optional)", () => {
    it("When PATCH /config is called, Then still dispatches (no-op update) and returns 200", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ platformId: "platform-1" }),
      };
      const app = buildApp(commandBus);

      const res = await app.request("/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(commandBus.dispatch).toHaveBeenCalledOnce();
    });
  });

  describe("Given a request with system_wallet_shard_count=64", () => {
    it("When PATCH /config is called, Then dispatches with the shard count", async () => {
      const commandBus: ICommandBus = {
        dispatch: vi.fn().mockResolvedValue({ platformId: "platform-1" }),
      };
      const app = buildApp(commandBus);

      const res = await app.request("/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_wallet_shard_count: 64 }),
      });

      expect(res.status).toBe(200);
      const dispatched = (commandBus.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
        systemWalletShardCount: number | undefined;
      };
      expect(dispatched.systemWalletShardCount).toBe(64);
    });
  });

  describe("Given a request with a shard count above the max (1025)", () => {
    it("When PATCH /config is called, Then returns 400 validation error", async () => {
      const commandBus: ICommandBus = { dispatch: vi.fn() };
      const app = buildApp(commandBus);

      const res = await app.request("/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_wallet_shard_count: 1025 }),
      });

      expect(res.status).toBe(400);
      expect(commandBus.dispatch).not.toHaveBeenCalled();
    });
  });
});
