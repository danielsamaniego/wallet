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
        const res = await app.app.fetch(
          new Request("http://localhost/v1/wallets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": "no-dot-separator-key",
              "Idempotency-Key": "auth-no-dot-1",
            },
            body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
          }),
        );

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
        const res = await app.app.fetch(
          new Request("http://localhost/v1/wallets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": forgedKey,
              "Idempotency-Key": "auth-wrong-secret-1",
            },
            body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
          }),
        );

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBe("INVALID_API_KEY");
      });
    });
  });

  describe("Given an empty API key", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401", async () => {
        const res = await app.app.fetch(
          new Request("http://localhost/v1/wallets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": "",
              "Idempotency-Key": "auth-empty-key-1",
            },
            body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
          }),
        );

        // Empty header may be treated as missing or invalid
        expect(res.status).toBe(401);
      });
    });
  });

  describe("Given an API key containing a SQL injection payload", () => {
    describe("When using it to authenticate", () => {
      it("Then it should return 401 without executing the SQL", async () => {
        const sqlInjectionKey = "' OR 1=1 --.secret";
        const res = await app.app.fetch(
          new Request("http://localhost/v1/wallets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": sqlInjectionKey,
              "Idempotency-Key": "auth-sql-inject-1",
            },
            body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
          }),
        );

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
        const res = await app.app.fetch(
          new Request("http://localhost/v1/wallets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": oversizedKey,
              "Idempotency-Key": "auth-oversize-1",
            },
            body: JSON.stringify({ owner_id: "user-1", currency_code: "USD" }),
          }),
        );

        // Should reject with 401 (invalid) or 413 (too large), never 500
        expect([401, 413]).toContain(res.status);
      });
    });
  });
});
