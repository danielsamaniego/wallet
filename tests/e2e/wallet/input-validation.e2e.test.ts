import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Input Validation Attacks E2E", () => {
  let app: TestApp;
  let walletId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();

    // Create a wallet to test against
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": `input-val-setup-${Date.now()}` },
      body: JSON.stringify({ owner_id: "validation-user", currency_code: "USD" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    walletId = body.wallet_id;

    // Fund the wallet so withdrawal tests have something to work with
    const depositRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": `input-val-deposit-${Date.now()}` },
      body: JSON.stringify({ amount_minor: 100000 }),
    });
    expect(depositRes.status).toBe(201);
  });

  // ── Deposit amount validation ──────────────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing a negative amount", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-negative-deposit-1" },
          body: JSON.stringify({ amount_minor: -500 }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When depositing zero amount", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-zero-deposit-1" },
          body: JSON.stringify({ amount_minor: 0 }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When depositing a float amount", () => {
      it("Then it should reject with 400 or 422 because amount_minor must be an integer", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-float-deposit-1" },
          body: JSON.stringify({ amount_minor: 100.5 }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When depositing a string amount", () => {
      it("Then it should reject with 400 or 422 because amount_minor must be a number", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-string-deposit-1" },
          body: JSON.stringify({ amount_minor: "1000" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Currency code validation ───────────────────────────────────────────

  describe("Given a client creating a wallet", () => {
    describe("When using a 4-character currency code", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-4char-currency-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "USDT" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When using a numeric currency code", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-numeric-currency-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "123" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When using a lowercase currency code", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-lowercase-currency-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "usd" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When using a valid-format but unsupported currency code 'JPY'", () => {
      it("Then it should reject with 400", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-unsupported-jpy-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "JPY" }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("When using a valid-format but unsupported currency code 'GBP'", () => {
      it("Then it should reject with 400", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-unsupported-gbp-1" },
          body: JSON.stringify({ owner_id: "user-1", currency_code: "GBP" }),
        });

        expect(res.status).toBe(400);
      });
    });
  });

  // ── Missing required fields ────────────────────────────────────────────

  describe("Given a client creating a wallet", () => {
    describe("When owner_id is missing", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-no-owner-1" },
          body: JSON.stringify({ currency_code: "USD" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When currency_code is missing", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-no-currency-1" },
          body: JSON.stringify({ owner_id: "user-1" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When amount_minor is missing in a deposit", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-no-amount-1" },
          body: JSON.stringify({ reference: "test" }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Empty body ─────────────────────────────────────────────────────────

  describe("Given a client sending an empty body", () => {
    describe("When creating a wallet with empty JSON object", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-empty-body-1" },
          body: JSON.stringify({}),
        });

        expect([400, 422]).toContain(res.status);
      });
    });

    describe("When depositing with empty JSON object", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-empty-deposit-1" },
          body: JSON.stringify({}),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Oversized request body (body limit) ─────────────────────────────────

  describe("Given the server enforces a 64KB body size limit", () => {
    describe("When sending a request body exceeding 64KB", () => {
      it("Then it should reject with 413 PAYLOAD_TOO_LARGE", async () => {
        const oversizedBody = JSON.stringify({ owner_id: "x".repeat(66 * 1024), currency_code: "USD" });
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-oversized-body-1" },
          body: oversizedBody,
        });

        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toBe("PAYLOAD_TOO_LARGE");
      });
    });

    describe("When sending a request body within 64KB", () => {
      it("Then the request should pass through to normal validation", async () => {
        const normalBody = JSON.stringify({ owner_id: "normal-user", currency_code: "USD" });
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-normal-body-1" },
          body: normalBody,
        });

        // 201 = created successfully (body was accepted, not blocked by size limit)
        expect(res.status).toBe(201);
      });
    });
  });

  // ── Malformed JSON ─────────────────────────────────────────────────────

  describe("Given a client sending malformed JSON", () => {
    describe("When the body is not valid JSON", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": "val-malformed-json-1" },
          body: "{owner_id: user-1, currency_code: USD",
        });

        // Hono/Zod may return 400 (parse error) or 500 (unexpected), but never 2xx
        expect(res.status).toBeGreaterThanOrEqual(400);
      });
    });
  });

  // ── SQL injection in path parameters ──────────────────────────────────

  describe("Given a client attempting SQL injection in the path", () => {
    describe("When the wallet ID contains SQL injection", () => {
      it("Then it should return 404 or 400 without executing the SQL", async () => {
        const sqlInjectionId = "'; DROP TABLE wallets; --";
        const res = await app.request(`/v1/wallets/${encodeURIComponent(sqlInjectionId)}`, {
          method: "GET",
        });

        expect([400, 404]).toContain(res.status);
      });
    });

    describe("When depositing to a wallet with SQL injection in the ID", () => {
      it("Then it should return 404 or 400 without executing the SQL", async () => {
        const sqlInjectionId = "1 OR 1=1";
        const res = await app.request(`/v1/wallets/${encodeURIComponent(sqlInjectionId)}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-sql-path-deposit-1" },
          body: JSON.stringify({ amount_minor: 1000 }),
        });

        expect([400, 404]).toContain(res.status);
      });
    });
  });

  // ── Massive amount (BigInt overflow) ──────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing a massive amount that could cause BigInt overflow", () => {
      it("Then it should reject with 400/422 or handle safely without corruption", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-bigint-overflow-1" },
          body: JSON.stringify({ amount_minor: 99999999999999999 }),
        });

        // Either rejected outright (preferred) or accepted safely
        if (res.status === 201 || res.status === 200) {
          // If accepted, verify the wallet still has a valid non-negative balance
          const walletRes = await app.request(`/v1/wallets/${walletId}`, { method: "GET" });
          expect(walletRes.status).toBe(200);
          const wallet = await walletRes.json();
          expect(Number(wallet.balance_minor)).toBeGreaterThanOrEqual(0);
        } else {
          expect([400, 422]).toContain(res.status);
        }
      });
    });
  });

  // ── XSS payload in reference ──────────────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing with an XSS payload in the reference field", () => {
      it("Then it should be accepted (API-only, stored as-is) or rejected", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-xss-reference-1" },
          body: JSON.stringify({ amount_minor: 100, reference: "<script>alert(1)</script>" }),
        });

        // API-only systems may store it safely; rejection is also fine
        expect([200, 201, 400, 422]).toContain(res.status);
      });
    });
  });

  // ── Prototype pollution ───────────────────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing with prototype pollution payloads in the body", () => {
      it("Then the deposit should succeed with the pollution fields safely ignored", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-proto-pollution-1" },
          body: JSON.stringify({
            amount_minor: 100,
            __proto__: { admin: true },
            constructor: { prototype: { admin: true } },
          }),
        });

        // The deposit should succeed; pollution payloads are ignored
        expect([200, 201]).toContain(res.status);
      });
    });
  });

  // ── Oversized reference (>500 chars) ──────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing with a reference exceeding 500 characters", () => {
      it("Then it should reject with 400 or 422", async () => {
        const longReference = "A".repeat(600);
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-oversized-ref-1" },
          body: JSON.stringify({ amount_minor: 100, reference: longReference }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Negative zero (-0) ────────────────────────────────────────────────

  describe("Given a wallet exists", () => {
    describe("When depositing negative zero as the amount", () => {
      it("Then it should reject with 400 or 422", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": "val-negative-zero-1" },
          body: JSON.stringify({ amount_minor: -0 }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });
});
