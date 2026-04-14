import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { TEST_API_KEY_ID } from "@test/helpers/db.js";

describe("Authentication Attacks E2E", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  /** Helper: make a raw request with a custom API key header */
  async function requestWithKey(apiKey: string, idempotencyKey: string): Promise<Response> {
    return fetch(`${app.baseUrl}/v1/wallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
    });
  }

  describe("Given an unauthenticated client", () => {
    describe("When requesting a protected endpoint without an API key", () => {
      it("Then it should return 401 MISSING_API_KEY", async () => {
        const res = await app.unauthenticatedRequest("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "auth-no-key-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_API_KEY");
      });
    });

    describe("When requesting a GET endpoint without an API key", () => {
      it("Then it should return 401 MISSING_API_KEY", async () => {
        const res = await app.unauthenticatedRequest("/v1/wallets/some-wallet-id");

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("MISSING_API_KEY");
      });
    });
  });

  describe("Given an API key without a dot separator", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401 INVALID_API_KEY", async () => {
        const res = await requestWithKey("no-dot-separator-key", "auth-no-dot-1");

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("INVALID_API_KEY");
      });
    });
  });

  describe("Given a valid key ID paired with a wrong secret", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401 INVALID_API_KEY", async () => {
        const forgedKey = `${TEST_API_KEY_ID}.completely-wrong-secret-value`;
        const res = await requestWithKey(forgedKey, "auth-wrong-secret-1");

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("INVALID_API_KEY");
      });
    });
  });

  describe("Given an empty API key", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401", async () => {
        const res = await requestWithKey("", "auth-empty-key-1");

        expect(res.status).toBe(401);
      });
    });
  });

  describe("Given an API key containing a SQL injection payload", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401 without executing the SQL", async () => {
        const res = await requestWithKey("' OR 1=1 --.secret", "auth-sql-inject-1");

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("INVALID_API_KEY");
      });
    });
  });

  describe("Given an oversized API key (10000 characters)", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401 or 413 without crashing", async () => {
        const oversizedKey = `${"x".repeat(5000)}.${"y".repeat(5000)}`;
        const res = await requestWithKey(oversizedKey, "auth-oversize-1");

        expect([401, 413]).toContain(res.status);
      });
    });
  });
});
