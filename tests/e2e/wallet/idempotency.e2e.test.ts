import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Idempotency Attacks E2E", () => {
  let app: TestApp;
  let walletId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();

    // Create a wallet and deposit funds for withdrawal/transfer tests
    const createRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": "idemp-setup-create" },
      body: JSON.stringify({ owner_id: "user-idemp", currency_code: "USD" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    walletId = createBody.wallet_id;

    const depositRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": "idemp-setup-deposit" },
      body: JSON.stringify({ amount_minor: 50000 }),
    });
    expect(depositRes.status).toBe(201);
  });

  describe("Given a successful deposit with a specific idempotency key", () => {
    describe("When replaying the exact same request with the same key and body", () => {
      it("Then it should return the cached response with the same status and body", async () => {
        const idempKey = "idemp-replay-deposit-1";
        const body = JSON.stringify({ amount_minor: 1000 });

        // First request
        const res1 = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempKey },
          body,
        });
        expect(res1.status).toBe(201);
        const body1 = await res1.json();
        expect(body1.transaction_id).toBeDefined();
        expect(body1.movement_id).toBeDefined();

        // Replay same request
        const res2 = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempKey },
          body,
        });
        expect(res2.status).toBe(201);
        const body2 = await res2.json();

        // Cached response must match the original exactly
        expect(body2.transaction_id).toBe(body1.transaction_id);
        expect(body2.movement_id).toBe(body1.movement_id);
      });
    });
  });

  describe("Given a deposit completed with a specific idempotency key", () => {
    describe("When reusing the same key with a different request body", () => {
      it("Then it should reject with 422 IDEMPOTENCY_PAYLOAD_MISMATCH", async () => {
        const idempKey = "idemp-mismatch-1";

        // First request: deposit 1000
        const res1 = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempKey },
          body: JSON.stringify({ amount_minor: 1000 }),
        });
        expect(res1.status).toBe(201);

        // Same key, different amount -> payload mismatch
        const res2 = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempKey },
          body: JSON.stringify({ amount_minor: 9999 }),
        });

        expect(res2.status).toBe(422);
        const body2 = await res2.json();
        expect(body2.error).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
      });
    });
  });

  describe("Given a mutation endpoint that requires an idempotency key", () => {
    describe("When sending a deposit request without an Idempotency-Key header", () => {
      it("Then it should reject with 400 MISSING_IDEMPOTENCY_KEY", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
      });
    });

    describe("When sending a withdrawal request without an Idempotency-Key header", () => {
      it("Then it should reject with 400 MISSING_IDEMPOTENCY_KEY", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
      });
    });

    describe("When sending a wallet creation request without an Idempotency-Key header", () => {
      it("Then it should reject with 400 MISSING_IDEMPOTENCY_KEY", async () => {
        const res = await app.request("/v1/wallets", {
          method: "POST",
          body: JSON.stringify({ owner_id: "user-no-key", currency_code: "EUR" }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
      });
    });

    describe("When sending a transfer request without an Idempotency-Key header", () => {
      it("Then it should reject with 400 MISSING_IDEMPOTENCY_KEY", async () => {
        const res = await app.request("/v1/transfers", {
          method: "POST",
          body: JSON.stringify({
            source_wallet_id: walletId,
            target_wallet_id: walletId,
            amount_minor: 100,
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("MISSING_IDEMPOTENCY_KEY");
      });
    });
  });

  describe("Given two different platforms using the same idempotency key", () => {
    describe("When both platforms create wallets with the same key value", () => {
      it("Then both requests should succeed because idempotency is scoped per platform", async () => {
        const sharedKey = "idemp-cross-platform-shared-key";

        // Platform 1 creates a wallet
        const res1 = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": sharedKey },
          body: JSON.stringify({ owner_id: "user-plat1", currency_code: "EUR" }),
        });
        expect(res1.status).toBe(201);
        const body1 = await res1.json();
        expect(body1.wallet_id).toBeDefined();

        // Platform 2 (attacker) creates a wallet with the same idempotency key
        const res2 = await app.attackerRequest("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": sharedKey },
          body: JSON.stringify({ owner_id: "user-plat2", currency_code: "EUR" }),
        });
        expect(res2.status).toBe(201);
        const body2 = await res2.json();
        expect(body2.wallet_id).toBeDefined();

        // They must be different wallets (different platforms)
        expect(body2.wallet_id).not.toBe(body1.wallet_id);
      });
    });
  });

  // ── Cross-endpoint same idempotency key ───────────────────────────────

  describe("Given a deposit completed with a specific idempotency key", () => {
    describe("When reusing the same key on a different endpoint (withdraw)", () => {
      it("Then it should reject with 422 because method:path differs in hash", async () => {
        const crossKey = "idemp-cross-endpoint-1";

        // First: deposit with this key
        const res1 = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": crossKey },
          body: JSON.stringify({ amount_minor: 100 }),
        });
        expect(res1.status).toBe(201);

        // Second: withdraw with the same key on the same wallet
        const res2 = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": crossKey },
          body: JSON.stringify({ amount_minor: 100 }),
        });

        expect(res2.status).toBe(422);
        const body2 = await res2.json();
        expect(body2.error).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
      });
    });
  });
});
