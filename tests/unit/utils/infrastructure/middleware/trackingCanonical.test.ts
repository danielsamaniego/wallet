import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { trackingCanonical } from "@/utils/infrastructure/middleware/trackingCanonical.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { createMockLogger, createMockIDGenerator } from "@test/helpers/mocks/index.js";

describe("trackingCanonical middleware", () => {
  describe("Given a request without X-Tracking-Id header", () => {
    describe("When the middleware runs", () => {
      it("Then it generates a new tracking ID and sets context variables", async () => {
        const idGen = createMockIDGenerator(["generated-id"]);
        const logger = createMockLogger();
        const app = new Hono<{ Variables: HonoVariables }>();

        app.use("*", trackingCanonical(idGen, logger));
        app.get("/test", (c) => {
          return c.json({
            trackingId: c.get("trackingId"),
            startTs: c.get("startTs"),
          });
        });

        const res = await app.request("/test");
        const body = await res.json();

        expect(body.trackingId).toBe("generated-id");
        expect(body.startTs).toBeTypeOf("number");
        expect(logger.dispatchCanonicalInfo).toHaveBeenCalled();
      });
    });
  });

  describe("Given a request with X-Tracking-Id header", () => {
    describe("When the middleware runs", () => {
      it("Then it uses the external tracking ID with ext- prefix", async () => {
        const idGen = createMockIDGenerator();
        const logger = createMockLogger();
        const app = new Hono<{ Variables: HonoVariables }>();

        app.use("*", trackingCanonical(idGen, logger));
        app.get("/test", (c) => c.json({ trackingId: c.get("trackingId") }));

        const res = await app.request("/test", {
          headers: { "x-tracking-id": "external-abc" },
        });
        const body = await res.json();

        expect(body.trackingId).toBe("ext-external-abc");
        // idGen.newId should NOT have been called
        expect(idGen.newId).not.toHaveBeenCalled();
      });
    });
  });
});
