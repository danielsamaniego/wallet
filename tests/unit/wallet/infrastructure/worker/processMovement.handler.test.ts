import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { processMovementRoute } from "@/wallet/infrastructure/adapters/inbound/worker/processMovement.handler.js";
import { ProcessMovementCommand } from "@/wallet/application/worker/processMovement/command.js";
import type { ICommandBus } from "@/utils/application/cqrs.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import { createMockIDGenerator, createMockLogger } from "@test/helpers/mocks/index.js";

/**
 * The handler trusts that `qstashSignature` middleware has already run and
 * placed the raw request body on the context. These tests inject `rawBody`
 * directly so we can exercise the handler in isolation from the verifier.
 */
function buildApp(rawBody: string | undefined, commandBus: ICommandBus) {
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
  app.post(
    "/internal/worker/process-movement",
    ...processMovementRoute(commandBus, idGen, logger),
  );

  return app;
}

function mockBus(dispatch: ICommandBus["dispatch"]): ICommandBus {
  return { dispatch };
}

describe("processMovementRoute", () => {
  describe("Given the middleware did not populate rawBody (wiring bug)", () => {
    it("Then it returns 500 INTERNAL_ERROR without ever dispatching the command", async () => {
      const dispatch = vi.fn();
      const app = buildApp(undefined, mockBus(dispatch as unknown as ICommandBus["dispatch"]));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("INTERNAL_ERROR");
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("Given a body that is not valid JSON", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const dispatch = vi.fn();
      const app = buildApp("not-json{", mockBus(dispatch as unknown as ICommandBus["dispatch"]));

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("Given a JSON body that does not match the schema (missing movement_id)", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const dispatch = vi.fn();
      const app = buildApp(
        JSON.stringify({ wrong_field: "x" }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a JSON body with an oversized movement_id (256 chars)", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const dispatch = vi.fn();
      const app = buildApp(
        JSON.stringify({ movement_id: "a".repeat(256) }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a JSON body with an empty movement_id", () => {
    it("Then it returns 400 INVALID_BODY", async () => {
      const dispatch = vi.fn();
      const app = buildApp(
        JSON.stringify({ movement_id: "" }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_BODY");
    });
  });

  describe("Given a valid body and the use case returns outcome=posted", () => {
    it("Then it dispatches ProcessMovementCommand and returns 200 with outcome=posted", async () => {
      const movementId = "019e15c7-50a2-7d3c-bc44-8b3640e42e05";
      const dispatch = vi.fn().mockResolvedValue({ outcome: "posted" });
      const app = buildApp(
        JSON.stringify({ movement_id: movementId }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, movement_id: movementId, outcome: "posted" });
      expect(dispatch).toHaveBeenCalledOnce();
      const [, cmd] = dispatch.mock.calls[0]!;
      expect(cmd).toBeInstanceOf(ProcessMovementCommand);
      expect(cmd.movementId).toBe(movementId);
    });
  });

  describe("Given a valid body and the use case returns outcome=failed with reason", () => {
    it("Then it returns 200 carrying outcome=failed and the failed_reason — QStash never retries a terminal outcome", async () => {
      const movementId = "019e15c7-50a2-7d3c-bc44-8b3640e42e05";
      const dispatch = vi.fn().mockResolvedValue({
        outcome: "failed",
        failedReason: "insufficient funds",
      });
      const app = buildApp(
        JSON.stringify({ movement_id: movementId }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        movement_id: movementId,
        outcome: "failed",
        failed_reason: "insufficient funds",
      });
    });
  });

  describe("Given a valid body and the use case returns outcome=noop (another worker won the race)", () => {
    it("Then it returns 200 with outcome=noop and no failed_reason", async () => {
      const movementId = "019e15c7-50a2-7d3c-bc44-8b3640e42e05";
      const dispatch = vi.fn().mockResolvedValue({ outcome: "noop" });
      const app = buildApp(
        JSON.stringify({ movement_id: movementId }),
        mockBus(dispatch as unknown as ICommandBus["dispatch"]),
      );

      const res = await app.request("/internal/worker/process-movement", { method: "POST" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, movement_id: movementId, outcome: "noop" });
      expect(body).not.toHaveProperty("failed_reason");
    });
  });
});
