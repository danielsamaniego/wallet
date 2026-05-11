import { describe, it, expect, beforeAll } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

/**
 * E2E for `POST /internal/worker/process-movement`.
 *
 * Phase 1C scaffolding: this endpoint exists only so QStash can deliver
 * messages once Phase 2 wires the real worker logic. For now the happy
 * path requires a valid Upstash-Signature JWT — which is too expensive
 * to forge inside an E2E test (we'd need to HMAC-sign the JWT with the
 * dev signing key). The handler happy path is covered by unit tests
 * with a mocked Receiver. Here we cover the negative auth paths and
 * the "wrong auth scheme" surface that an external scanner might try.
 */
describe("POST /internal/worker/process-movement E2E", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  // ── Signature missing or wrong ─────────────────────────────────────

  describe("Given no Upstash-Signature header", () => {
    describe("When POSTing a syntactically valid body", () => {
      it("Then it returns 401 MISSING_SIGNATURE", async () => {
        const res = await app.unauthenticatedRequest("/internal/worker/process-movement", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ movement_id: "019e15c7-50a2-7d3c-bc44-8b3640e42e05" }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_SIGNATURE");
      });
    });
  });

  describe("Given a malformed Upstash-Signature value", () => {
    describe("When POSTing any body", () => {
      it("Then it returns 401 INVALID_SIGNATURE without leaking the underlying error", async () => {
        const res = await app.unauthenticatedRequest("/internal/worker/process-movement", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "upstash-signature": "not.a.jwt",
          },
          body: JSON.stringify({ movement_id: "019e15c7-50a2-7d3c-bc44-8b3640e42e05" }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("INVALID_SIGNATURE");
        const serialized = JSON.stringify(body);
        expect(serialized).not.toMatch(/JWT/i);
        expect(serialized).not.toMatch(/HMAC/i);
      });
    });
  });

  // ── Wrong auth scheme (API key) — must NOT bypass the JWT check ────

  describe("Given a valid X-API-Key header but no Upstash-Signature", () => {
    describe("When POSTing", () => {
      it("Then it still returns 401 — the worker endpoint is not API-key authenticated", async () => {
        // app.request adds the test platform's X-API-Key, which is enough
        // for /v1/* endpoints but must NOT be enough for /internal/worker/*.
        const res = await app.request("/internal/worker/process-movement", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ movement_id: "019e15c7-50a2-7d3c-bc44-8b3640e42e05" }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_SIGNATURE");
      });
    });
  });

  // ── Method discipline ──────────────────────────────────────────────

  describe("Given a GET request to the worker endpoint", () => {
    describe("When invoked with or without signature", () => {
      it("Then it returns 404 — the route is POST-only", async () => {
        const res = await app.unauthenticatedRequest("/internal/worker/process-movement", {
          method: "GET",
        });
        expect(res.status).toBe(404);
      });
    });
  });

  describe("Given an unknown path under /internal/worker/", () => {
    describe("When invoked", () => {
      it("Then it returns 404 — no other worker endpoints exist yet", async () => {
        const res = await app.unauthenticatedRequest("/internal/worker/unknown-action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Information disclosure ─────────────────────────────────────────

  describe("Given any 401 from the worker endpoint", () => {
    describe("When inspecting the body", () => {
      it("Then it does not include a stack trace or framework names", async () => {
        const res = await app.unauthenticatedRequest("/internal/worker/process-movement", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "upstash-signature": "tampered",
          },
          body: JSON.stringify({ movement_id: "x" }),
        });

        const text = await res.text();
        expect(text).not.toMatch(/at .+\(.+:\d+:\d+\)/);
        expect(text).not.toMatch(/PrismaClient/i);
        expect(text).not.toMatch(/@upstash\/qstash/i);
      });
    });
  });
});
