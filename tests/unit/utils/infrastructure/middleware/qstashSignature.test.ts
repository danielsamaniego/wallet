import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { qstashSignature } from "@/utils/infrastructure/middleware/qstashSignature.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

/** Minimal stand-in for the @upstash/qstash `Receiver` shape used by the middleware. */
type ReceiverLike = { verify: (args: { signature: string; body: string }) => Promise<boolean> };

function buildApp(receiver: ReceiverLike) {
  const app = new Hono<{ Variables: HonoVariables }>();

  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    await next();
  });

  app.use("/internal/*", qstashSignature(receiver));
  app.post("/internal/worker/echo", async (c) => {
    return c.json({ ok: true, rawBody: c.get("rawBody") ?? null });
  });

  return app;
}

describe("qstashSignature middleware", () => {
  describe("Given no Upstash-Signature header", () => {
    it("Then returns 401 MISSING_SIGNATURE and never calls verify", async () => {
      const verify = vi.fn();
      const app = buildApp({ verify });

      const res = await app.request("/internal/worker/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ movement_id: "mov-1" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("MISSING_SIGNATURE");
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("Given a valid signature for the request body", () => {
    it("Then it calls next() and the downstream handler sees the raw body", async () => {
      const verify = vi.fn().mockResolvedValue(true);
      const app = buildApp({ verify });
      const rawBody = JSON.stringify({ movement_id: "mov-1" });

      const res = await app.request("/internal/worker/echo", {
        method: "POST",
        headers: { "content-type": "application/json", "upstash-signature": "valid.jwt.token" },
        body: rawBody,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.rawBody).toBe(rawBody);
      expect(verify).toHaveBeenCalledWith({ signature: "valid.jwt.token", body: rawBody });
    });
  });

  describe("Given a signature the receiver rejects (returns false)", () => {
    it("Then returns 401 INVALID_SIGNATURE", async () => {
      const verify = vi.fn().mockResolvedValue(false);
      const app = buildApp({ verify });

      const res = await app.request("/internal/worker/echo", {
        method: "POST",
        headers: { "content-type": "application/json", "upstash-signature": "tampered" },
        body: JSON.stringify({ movement_id: "mov-1" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_SIGNATURE");
    });
  });

  describe("Given the receiver throws (e.g. malformed JWT)", () => {
    it("Then it returns 401 INVALID_SIGNATURE without leaking the underlying error", async () => {
      const verify = vi.fn().mockRejectedValue(new Error("JWT malformed at byte 7"));
      const app = buildApp({ verify });

      const res = await app.request("/internal/worker/echo", {
        method: "POST",
        headers: { "content-type": "application/json", "upstash-signature": "bogus" },
        body: JSON.stringify({ movement_id: "mov-1" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_SIGNATURE");
      expect(JSON.stringify(body)).not.toMatch(/JWT malformed at byte 7/);
    });
  });
});
