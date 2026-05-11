import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { processMovementRoute } from "@/wallet/infrastructure/adapters/inbound/worker/processMovement.handler.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import { createMockIDGenerator, createMockLogger } from "@test/helpers/mocks/index.js";

/**
 * The handler trusts that `qstashSignature` middleware has already run and
 * placed the raw request body on the context. These tests inject `rawBody`
 * directly so we can exercise the handler in isolation from the verifier.
 */
function buildApp(rawBody: string | undefined) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    if (rawBody !== undefined) c.set("rawBody", rawBody);
    await next();
  });

  const idGen = createMockIDGenerator();
  const logger = createMockLogger();
  app.post("/internal/worker/process-movement", ...processMovementRoute(idGen, logger));

  return app;
}

describe("processMovementRoute (Phase 1C scaffolding)", () => {
  describe("Given the middleware did not populate rawBody (wiring bug)", () => {
    it("Then it returns 500 INTERNAL_ERROR", async () => {
      const app = buildApp(undefined);

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("INTERNAL_ERROR");
    });
  });

  describe("Given a body that is not valid JSON", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const app = buildApp("not-json{");

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a JSON body that does not match the schema (missing movement_id)", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const app = buildApp(JSON.stringify({ wrong_field: "x" }));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a JSON body with an oversized movement_id (256 chars)", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const app = buildApp(JSON.stringify({ movement_id: "a".repeat(256) }));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a JSON body with an empty movement_id", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const app = buildApp(JSON.stringify({ movement_id: "" }));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a valid body with movement_id", () => {
    it("Then it acks with 200 and echoes the movement_id (Phase 1C: no business logic yet)", async () => {
      const movementId = "019e15c7-50a2-7d3c-bc44-8b3640e42e05";
      const app = buildApp(JSON.stringify({ movement_id: movementId }));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.movement_id).toBe(movementId);
    });
  });
});
