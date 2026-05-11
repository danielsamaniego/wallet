import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { workerRoutes } from "@/wallet/infrastructure/adapters/inbound/worker/worker.routes.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";
import type { Dependencies } from "@/wiring.js";
import { createMockIDGenerator, createMockLogger } from "@test/helpers/mocks/index.js";

function buildHostApp(routerDeps: Dependencies) {
  // Mirrors the real mount in `src/app.ts`: tracking middleware first, then
  // the worker subrouter under /internal/worker.
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    await next();
  });
  app.route("/internal/worker", workerRoutes(routerDeps));
  return app;
}

function baseDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    config: {} as Dependencies["config"],
    prisma: {} as Dependencies["prisma"],
    idGen: createMockIDGenerator(),
    logger: createMockLogger(),
    idempotencyStore: {} as Dependencies["idempotencyStore"],
    commandBus: {} as Dependencies["commandBus"],
    queryBus: {} as Dependencies["queryBus"],
    ...overrides,
  };
}

describe("workerRoutes", () => {
  describe("Given qstashReceiver is undefined (no signing keys configured)", () => {
    it("Then the router mounts no routes — /internal/worker/process-movement is 404", async () => {
      const deps = baseDeps({ qstashReceiver: undefined });
      const app = buildHostApp(deps);

      const res = await app.request("/internal/worker/process-movement", {
        method: "POST",
        headers: { "content-type": "application/json", "upstash-signature": "anything" },
        body: JSON.stringify({ movement_id: "mov-1" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("Given qstashReceiver is wired", () => {
    it("Then /internal/worker/process-movement is mounted and gated by the signature middleware (401 on missing header)", async () => {
      const verify = vi.fn().mockResolvedValue(true);
      const deps = baseDeps({ qstashReceiver: { verify } });
      const app = buildHostApp(deps);

      const res = await app.request("/internal/worker/process-movement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ movement_id: "mov-1" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("MISSING_SIGNATURE");
      expect(verify).not.toHaveBeenCalled();
    });

    it("Then a valid signature reaches the handler and returns 200", async () => {
      const verify = vi.fn().mockResolvedValue(true);
      const deps = baseDeps({ qstashReceiver: { verify } });
      const app = buildHostApp(deps);
      const movementId = "019e15c7-50a2-7d3c-bc44-8b3640e42e05";

      const res = await app.request("/internal/worker/process-movement", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "upstash-signature": "valid.jwt.token",
        },
        body: JSON.stringify({ movement_id: movementId }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.movement_id).toBe(movementId);
      expect(verify).toHaveBeenCalledOnce();
    });
  });
});
