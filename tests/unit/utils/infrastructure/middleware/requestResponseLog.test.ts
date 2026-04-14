import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { requestResponseLog } from "@/utils/infrastructure/middleware/requestResponseLog.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import { createMockLogger } from "@test/helpers/mocks/index.js";

function buildApp(logger: ReturnType<typeof createMockLogger>) {
  const app = new Hono<{ Variables: HonoVariables }>();

  // Simulate trackingCanonical middleware
  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    await next();
  });

  app.use("*", requestResponseLog(logger));

  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", async (c) => {
    const body = await c.req.json();
    return c.json(body, 201);
  });

  return app;
}

describe("requestResponseLog middleware", () => {
  describe("Given a GET request", () => {
    describe("When the middleware runs", () => {
      it("Then it logs request and response without reading body", async () => {
        const logger = createMockLogger();
        const app = buildApp(logger);

        const res = await app.request("/test", { method: "GET" });

        expect(res.status).toBe(200);
        expect(logger.info).toHaveBeenCalled();
      });
    });
  });

  describe("Given a POST request with a body", () => {
    describe("When the middleware runs", () => {
      it("Then it reads the request body via clone and logs it", async () => {
        const logger = createMockLogger();
        const app = buildApp(logger);

        const res = await app.request("/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 100 }),
        });

        expect(res.status).toBe(201);
        // The first info call should contain the body
        const firstCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(firstCall![2]).toHaveProperty("body");
      });
    });
  });

  describe("Given a POST request where body clone fails", () => {
    describe("When the middleware runs", () => {
      it("Then it logs '(read error)' as body and still processes the request", async () => {
        const logger = createMockLogger();
        const app = new Hono<{ Variables: HonoVariables }>();

        app.use("*", async (c, next) => {
          c.set("trackingId", "test-tracking");
          c.set("startTs", Date.now());
          c.set("canonical", new CanonicalAccumulator());
          await next();
        });

        app.use("*", requestResponseLog(logger));

        app.post("/broken", (c) => c.json({ ok: true }));

        // Create a request where the raw body's clone().text() will throw.
        // We do this by constructing a Request with a used body, then patching
        // its `raw` property so that clone().text() rejects.
        const req = new Request("http://localhost/broken", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x: 1 }),
        });

        // Monkey-patch req.clone to throw. Hono's c.req.raw is the underlying
        // Request; overriding clone() causes the middleware catch to fire.
        const origClone = req.clone.bind(req);
        Object.defineProperty(req, "clone", {
          value: () => {
            const cloned = origClone();
            // Override text() on the cloned request to throw
            Object.defineProperty(cloned, "text", {
              value: () => Promise.reject(new Error("simulated read error")),
            });
            return cloned;
          },
        });

        const res = await app.request(req);

        // Verify the middleware logged "(read error)" for body
        const firstCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(firstCall![2]?.body).toBe("(read error)");
      });
    });
  });
});
