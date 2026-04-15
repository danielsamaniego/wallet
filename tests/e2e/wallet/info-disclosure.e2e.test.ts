import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Information Disclosure E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `info-disc-${++idempCounter}`;

  /** Sensitive keywords that must never appear in error responses. */
  const SENSITIVE_PATTERNS = ["stack", "prisma", "postgres", "postgresql", "pg_", "node_modules", "at Object.", "at Module.", "ECONNREFUSED"];

  /** Recursively stringify any value for pattern matching. */
  function deepStringify(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? "";
  }

  /** Assert that a response body does not contain sensitive internals. */
  function assertNoLeakedInternals(body: unknown): void {
    const bodyStr = deepStringify(body).toLowerCase();
    for (const pattern of SENSITIVE_PATTERNS) {
      expect(bodyStr).not.toContain(pattern.toLowerCase());
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── Error responses don't leak internal details ─────────────────────────

  describe("Given a request that triggers a 404 error", () => {
    describe("When reading the error response body", () => {
      it("Then it should not contain stack traces or internal technology names", async () => {
        const fakeId = "019560a0-0000-7000-8000-000000000099";
        const res = await app.request(`/v1/wallets/${fakeId}`);

        expect(res.status).toBe(404);
        const body = await res.json();
        assertNoLeakedInternals(body);
      });
    });
  });

  describe("Given a request with an invalid body that triggers a validation error", () => {
    describe("When reading the 400 error response body", () => {
      it("Then it should not contain stack traces or internal technology names", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "", currency_code: "INVALID" }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        assertNoLeakedInternals(body);
      });
    });
  });

  describe("Given a request that triggers a 422 domain error", () => {
    describe("When reading the error response body", () => {
      it("Then it should not contain stack traces or internal technology names", async () => {
        // Create wallet with zero balance, then try to withdraw
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "info-disc-owner", currency_code: "USD" }),
        });
        const { wallet_id } = await createRes.json();

        const res = await app.request(`/v1/wallets/${wallet_id}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 9999 }),
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        assertNoLeakedInternals(body);
      });
    });
  });

  describe("Given a request to a completely undefined route", () => {
    describe("When reading the 404 error response body", () => {
      it("Then it should not contain stack traces or internal technology names", async () => {
        const res = await app.request("/v1/nonexistent/endpoint/here");

        expect(res.status).toBe(404);
        const body = await res.json();
        assertNoLeakedInternals(body);
      });
    });
  });

  // ── No X-Powered-By header ──────────────────────────────────────────────

  describe("Given any API response", () => {
    describe("When inspecting the response headers", () => {
      it("Then X-Powered-By should not be present", async () => {
        const res = await app.request("/health");

        expect(res.headers.get("x-powered-by")).toBeNull();
      });

      it("Then X-Powered-By should not be present on error responses either", async () => {
        const res = await app.request("/v1/wallets/nonexistent-id");

        expect(res.headers.get("x-powered-by")).toBeNull();
      });
    });
  });

  // ── Consistent 404 for tenant isolation (no enumeration) ────────────────

  describe("Given a wallet owned by the victim platform and a non-existent wallet ID", () => {
    describe("When the attacker platform requests both wallet IDs", () => {
      it("Then both responses should be 404 with identical error structure (no enumeration)", async () => {
        // Create a wallet owned by the test platform
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "enum-test-owner", currency_code: "USD" }),
        });
        expect(createRes.status).toBe(201);
        const { wallet_id: existingWalletId } = await createRes.json();

        const nonExistentWalletId = "019560a0-0000-7000-8000-ffffffffffff";

        // Attacker requests the real wallet (belongs to different platform)
        const existingRes = await app.attackerRequest(`/v1/wallets/${existingWalletId}`);

        // Attacker requests a wallet that truly doesn't exist
        const nonExistentRes = await app.attackerRequest(`/v1/wallets/${nonExistentWalletId}`);

        // Both must return 404
        expect(existingRes.status).toBe(404);
        expect(nonExistentRes.status).toBe(404);

        // The response bodies should have the same structure (same keys)
        const existingBody = await existingRes.json();
        const nonExistentBody = await nonExistentRes.json();

        expect(Object.keys(existingBody).sort()).toEqual(Object.keys(nonExistentBody).sort());

        // Both should use the same error code (no difference that reveals existence)
        expect(existingBody.error).toBe(nonExistentBody.error);
      });
    });
  });
});
