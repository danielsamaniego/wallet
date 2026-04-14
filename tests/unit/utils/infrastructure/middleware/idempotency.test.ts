import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { idempotency } from "@/utils/infrastructure/middleware/idempotency.js";
import type { IIdempotencyStore, IdempotencyRecord } from "@/common/idempotency/application/ports/idempotency.store.js";
import type { HonoVariables } from "@/utils/infrastructure/hono.context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

function createMockStore(): IIdempotencyStore {
  return {
    acquire: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    deleteExpired: vi.fn().mockResolvedValue(0),
  };
}

/**
 * Builds a Hono test app with tracking context middleware (simulating trackingCanonical),
 * platformId set, and the idempotency middleware installed on POST /test.
 */
function buildApp(store: IIdempotencyStore, handlerStatus = 201, handlerBody = { id: "txn-1" }) {
  const app = new Hono<{ Variables: HonoVariables }>();

  // Simulate tracking middleware that sets required context variables
  app.use("*", async (c, next) => {
    c.set("trackingId", "test-tracking");
    c.set("startTs", Date.now());
    c.set("canonical", new CanonicalAccumulator());
    c.set("platformId", "platform-1");
    await next();
  });

  app.use("/test", idempotency(store));

  app.post("/test", (c) => c.json(handlerBody, handlerStatus as any));
  app.get("/test", (c) => c.json({ ok: true }));

  return app;
}

describe("idempotency middleware", () => {
  let store: IIdempotencyStore;

  beforeEach(() => {
    store = createMockStore();
  });

  // ── GET/HEAD passthrough ──────────────────────────────────────────

  describe("GET/HEAD passthrough", () => {
    it("Given a GET request, When middleware runs, Then passes through without checking idempotency", async () => {
      // Given
      const app = buildApp(store);

      // When
      const res = await app.request("/test", { method: "GET" });

      // Then
      expect(res.status).toBe(200);
      expect(store.acquire).not.toHaveBeenCalled();
    });
  });

  // ── Missing header ────────────────────────────────────────────────

  describe("Missing Idempotency-Key header", () => {
    it("Given a POST without Idempotency-Key header, When middleware runs, Then returns 400", async () => {
      // Given
      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 100 }),
      });

      // Then
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
    });
  });

  // ── Missing platform context ──────────────────────────────────────

  describe("Missing platform context", () => {
    it("Given no platformId in context, When middleware runs, Then returns 500", async () => {
      // Given — app without platformId middleware
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        // platformId NOT set
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.json({ ok: true }, 201));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      // Then
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("MISSING_PLATFORM_CONTEXT");
    });
  });

  // ── First request wins (acquire returns null) ─────────────────────

  describe("First request (acquire returns null)", () => {
    it("Given a new idempotency key, When middleware runs, Then proceeds to handler and completes record", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      // Then
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ id: "txn-1" });
      expect(store.acquire).toHaveBeenCalledOnce();
      // complete is called asynchronously (fire-and-forget), wait for microtask
      await new Promise((r) => setTimeout(r, 10));
      expect(store.complete).toHaveBeenCalledOnce();
    });
  });

  // ── Replay cached response ────────────────────────────────────────

  describe("Replay cached response", () => {
    it("Given an already-completed idempotency key with matching hash, When middleware runs, Then returns cached response", async () => {
      // Given
      const existing: IdempotencyRecord = {
        idempotencyKey: "key-1",
        platformId: "platform-1",
        requestHash: "", // will be computed by middleware — see below
        responseStatus: 201,
        responseBody: { id: "txn-1" },
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      // The middleware computes requestHash from method:path:body. We need to match it.
      const { createHash } = await import("node:crypto");
      const bodyStr = JSON.stringify({ amount: 100 });
      const expectedHash = createHash("sha256").update(`POST:/test:${bodyStr}`).digest("hex");
      existing.requestHash = expectedHash;

      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: bodyStr,
      });

      // Then
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ id: "txn-1" });
      // Handler should NOT have been called — store.complete should NOT be called
    });
  });

  // ── In-progress (pending) key ─────────────────────────────────────

  describe("In-progress key (responseStatus === 0)", () => {
    it("Given a pending idempotency key, When middleware runs, Then returns 409 IDEMPOTENCY_KEY_IN_PROGRESS", async () => {
      // Given
      const existing: IdempotencyRecord = {
        idempotencyKey: "key-1",
        platformId: "platform-1",
        requestHash: "some-hash",
        responseStatus: 0,
        responseBody: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      // Then
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");
    });
  });

  // ── Payload mismatch ──────────────────────────────────────────────

  describe("Payload mismatch", () => {
    it("Given an existing key with different request hash, When middleware runs, Then returns 422", async () => {
      // Given
      const existing: IdempotencyRecord = {
        idempotencyKey: "key-1",
        platformId: "platform-1",
        requestHash: "different-hash",
        responseStatus: 200,
        responseBody: { old: true },
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({ amount: 999 }),
      });

      // Then
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
    });
  });

  // ── 5xx handler response releases key ─────────────────────────────

  describe("5xx handler response", () => {
    it("Given handler returns 500, When middleware completes, Then releases the idempotency key", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        c.set("platformId", "platform-1");
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.json({ error: "boom" }, 500));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({}),
      });

      // Then
      expect(res.status).toBe(500);
      await new Promise((r) => setTimeout(r, 10));
      expect(store.release).toHaveBeenCalledOnce();
      expect(store.complete).not.toHaveBeenCalled();
    });
  });

  // ── 409 handler response releases key ─────────────────────────────

  describe("409 handler response", () => {
    it("Given handler returns 409, When middleware completes, Then releases the idempotency key", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        c.set("platformId", "platform-1");
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.json({ error: "conflict" }, 409));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({}),
      });

      // Then
      expect(res.status).toBe(409);
      await new Promise((r) => setTimeout(r, 10));
      expect(store.release).toHaveBeenCalledOnce();
      expect(store.complete).not.toHaveBeenCalled();
    });
  });

  // ── 4xx handler response (deterministic, cached) ──────────────────

  describe("4xx handler response", () => {
    it("Given handler returns 400, When middleware completes, Then caches the response via store.complete", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        c.set("platformId", "platform-1");
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.json({ error: "validation" }, 400));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({}),
      });

      // Then
      expect(res.status).toBe(400);
      await new Promise((r) => setTimeout(r, 10));
      // 4xx (except 409) is deterministic -> should be cached
      expect(store.complete).toHaveBeenCalledOnce();
      expect(store.release).not.toHaveBeenCalled();
    });
  });

  // ── release error is swallowed ──────────────────────────────────

  describe("release error handling", () => {
    it("Given store.release rejects, When a 5xx response triggers release, Then the error is swallowed", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (store.release as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("release failed"));
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        c.set("platformId", "platform-1");
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.json({ error: "boom" }, 500));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({}),
      });

      // Then - should not throw
      expect(res.status).toBe(500);
      await new Promise((r) => setTimeout(r, 10));
      expect(store.release).toHaveBeenCalledOnce();
    });
  });

  // ── complete error is swallowed ─────────────────────────────────

  describe("complete error handling", () => {
    it("Given store.complete rejects, When a 2xx response triggers complete, Then the error is swallowed", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (store.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("complete failed"));
      const app = buildApp(store);

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({ amount: 100 }),
      });

      // Then - should not throw
      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 10));
      expect(store.complete).toHaveBeenCalledOnce();
    });
  });

  // ── Response body parse failure (non-JSON response) ───────────────

  describe("Response body parse failure", () => {
    it("Given handler returns non-JSON response, When middleware tries to cache, Then completes with null body", async () => {
      // Given
      (store.acquire as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const app = new Hono<{ Variables: HonoVariables }>();
      app.use("*", async (c, next) => {
        c.set("trackingId", "test-tracking");
        c.set("startTs", Date.now());
        c.set("canonical", new CanonicalAccumulator());
        c.set("platformId", "platform-1");
        await next();
      });
      app.use("/test", idempotency(store));
      app.post("/test", (c) => c.text("plain text response", 200));

      // When
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "key-1",
        },
        body: JSON.stringify({}),
      });

      // Then
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(store.complete).toHaveBeenCalledOnce();
      const completeCall = (store.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(completeCall[3]).toBe(200); // responseStatus
      expect(completeCall[4]).toBeNull(); // responseBody (null from .catch)
    });
  });
});
