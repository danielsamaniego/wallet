import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { IQueryBus } from "@/utils/application/cqrs.js";
import { listPlatformsRoute } from "@/platform/infrastructure/adapters/inbound/http/listPlatforms/handler.js";

describe("listPlatformsRoute", () => {
  it("Given a valid request, When GET is called, Then it dispatches ListPlatformsQuery and returns 200", async () => {
    const queryBus: IQueryBus = {
      dispatch: vi.fn().mockResolvedValue({
        platforms: [
          {
            id: "plat-1",
            name: "Test Platform",
            status: "active",
            created_at: 1700000000000,
            updated_at: 1700000000000,
          },
        ],
        next_cursor: null,
      }),
    };

    const handlers = listPlatformsRoute(queryBus);
    const app = new Hono<{ Variables: HonoVariables }>();

    app.use("*", async (c, next) => {
      c.set("trackingId", "test-tracking");
      c.set("startTs", Date.now());
      c.set("canonical", new CanonicalAccumulator());
      c.set("platformId", "platform-1");
      await next();
    });

    app.get("/platforms", ...handlers);

    const res = await app.request("/platforms");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toHaveLength(1);
    expect(body.platforms[0].id).toBe("plat-1");
    expect(queryBus.dispatch).toHaveBeenCalledOnce();
  });
});
