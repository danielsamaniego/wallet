import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Edge Cases E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `edge-case-${++idempCounter}`;

  /** Helper: create a wallet and return its ID. */
  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    return json.wallet_id;
  }

  /** Helper: deposit into a wallet. */
  async function deposit(walletId: string, amountCents: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_cents: amountCents }),
    });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── Minimum deposit (1 cent) ────────────────────────────────────────────

  describe("Given an active wallet with zero balance", () => {
    describe("When depositing the minimum amount of 1 cent", () => {
      it("Then the deposit should succeed with 201", async () => {
        const walletId = await createWallet("min-deposit-owner");

        const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 1 }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.transaction_id).toBeDefined();
        expect(body.movement_id).toBeDefined();
      });

      it("Then the wallet balance should be 1 cent", async () => {
        const walletId = await createWallet("min-deposit-owner-balance");

        await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 1 }),
        });

        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        expect(walletRes.status).toBe(200);
        const wallet = await walletRes.json();
        expect(Number(wallet.balance_cents)).toBe(1);
      });
    });
  });

  // ── Cross-currency transfer ─────────────────────────────────────────────

  describe("Given a USD wallet and a EUR wallet", () => {
    describe("When attempting a transfer between them", () => {
      it("Then it should return 400 or 422 (currency mismatch)", async () => {
        const usdWallet = await createWallet("cross-currency-usd", "USD");
        const eurWallet = await createWallet("cross-currency-eur", "EUR");

        await deposit(usdWallet, 50000);

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({
            source_wallet_id: usdWallet,
            target_wallet_id: eurWallet,
            amount_cents: 1000,
          }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Non-existent wallet ─────────────────────────────────────────────────

  describe("Given a wallet ID that does not exist", () => {
    describe("When requesting the wallet details", () => {
      it("Then it should return 404", async () => {
        const fakeId = "019560a0-0000-7000-8000-000000000099";

        const res = await app.request(`/v1/wallets/${fakeId}`);

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Invalid UUID in path ────────────────────────────────────────────────

  describe("Given an invalid UUID in the wallet path", () => {
    describe("When requesting the wallet details", () => {
      it("Then it should return 404 or 400", async () => {
        const res = await app.request("/v1/wallets/not-a-valid-uuid-at-all");

        expect([400, 404]).toContain(res.status);
      });
    });

    describe("When attempting to deposit into it", () => {
      it("Then it should return 404 or 400", async () => {
        const res = await app.request("/v1/wallets/totally-invalid/deposit", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 1000 }),
        });

        expect([400, 404]).toContain(res.status);
      });
    });
  });

  // ── Transfer to non-existent wallet ─────────────────────────────────────

  describe("Given a funded source wallet and a non-existent target wallet ID", () => {
    describe("When attempting a transfer", () => {
      it("Then it should return 404", async () => {
        const sourceWallet = await createWallet("transfer-src-owner");
        await deposit(sourceWallet, 50000);

        const fakeTargetId = "019560a0-0000-7000-8000-000000000088";

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({
            source_wallet_id: sourceWallet,
            target_wallet_id: fakeTargetId,
            amount_cents: 1000,
          }),
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Capture non-existent hold ───────────────────────────────────────────

  describe("Given a hold ID that does not exist", () => {
    describe("When attempting to capture it", () => {
      it("Then it should return 404", async () => {
        const fakeHoldId = "019560a0-0000-7000-8000-000000000077";

        const res = await app.request(`/v1/holds/${fakeHoldId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });

        expect(res.status).toBe(404);
      });
    });
  });
});
