import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Hold Exploitation E2E", () => {
  let app: TestApp;
  let walletId: string;
  let idempCounter = 0;

  const nextKey = () => `hold-exploit-${++idempCounter}`;

  /** Helper: create a wallet and deposit a known balance. */
  async function setupFundedWallet(balanceCents = 10000): Promise<string> {
    const createRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: "hold-test-owner", currency_code: "USD" }),
    });
    const { wallet_id } = await createRes.json();

    await app.request(`/v1/wallets/${wallet_id}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_cents: balanceCents }),
    });

    return wallet_id;
  }

  /** Helper: place a hold and return the hold_id. */
  async function placeHold(wId: string, amountCents: number, expiresAt?: number): Promise<string> {
    const body: Record<string, unknown> = { wallet_id: wId, amount_cents: amountCents };
    if (expiresAt !== undefined) {
      body.expires_at = expiresAt;
    }
    const res = await app.request("/v1/holds", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return json.hold_id;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    walletId = await setupFundedWallet(10000);
  });

  // ── Hold prevents full withdrawal ────────────────────────────────────────

  describe("Given a wallet with 10000 cents and a hold of 3000 cents", () => {
    describe("When attempting to withdraw the full 10000 cents", () => {
      it("Then it should return 422 because available balance is only 7000 cents", async () => {
        await placeHold(walletId, 3000);

        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 10000 }),
        });

        expect(res.status).toBe(422);
      });
    });

    describe("When withdrawing 7000 cents (the available amount)", () => {
      it("Then it should succeed with 201", async () => {
        await placeHold(walletId, 3000);

        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 7000 }),
        });

        expect(res.status).toBe(201);
      });
    });
  });

  // ── Double capture ───────────────────────────────────────────────────────

  describe("Given a captured hold", () => {
    describe("When capturing the same hold a second time", () => {
      it("Then it should return 422", async () => {
        const holdId = await placeHold(walletId, 2000);

        // First capture
        const first = await app.request(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(first.status).toBe(201);

        // Second capture (different idempotency key)
        const second = await app.request(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(second.status).toBe(422);
      });
    });
  });

  // ── Capture after void ───────────────────────────────────────────────────

  describe("Given a voided hold", () => {
    describe("When attempting to capture it", () => {
      it("Then it should return 422", async () => {
        const holdId = await placeHold(walletId, 2000);

        // Void the hold
        const voidRes = await app.request(`/v1/holds/${holdId}/void`, {
          method: "POST",
        });
        expect(voidRes.status).toBe(200);

        // Attempt capture
        const captureRes = await app.request(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(422);
      });
    });
  });

  // ── Hold with past expiry ────────────────────────────────────────────────

  describe("Given a hold request with an expires_at timestamp in the past", () => {
    describe("When placing the hold", () => {
      it("Then it should return 400 or 422", async () => {
        const pastTimestamp = Date.now() - 60_000; // 1 minute ago

        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({
            wallet_id: walletId,
            amount_cents: 1000,
            expires_at: pastTimestamp,
          }),
        });

        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Oversized hold ──────────────────────────────────────────────────────

  describe("Given a wallet with 10000 cents and no existing holds", () => {
    describe("When placing a hold for 10001 cents (exceeding available balance)", () => {
      it("Then it should return 422", async () => {
        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({
            wallet_id: walletId,
            amount_cents: 10001,
          }),
        });

        expect(res.status).toBe(422);
      });
    });
  });

  // ── Attacker voids victim's hold ────────────────────────────────────────

  describe("Given a hold placed by the victim platform", () => {
    describe("When the attacker platform attempts to void the hold", () => {
      it("Then it should return 404 (hold not visible to attacker)", async () => {
        const holdId = await placeHold(walletId, 2000);

        const res = await app.attackerRequest(`/v1/holds/${holdId}/void`, {
          method: "POST",
        });

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Attacker captures victim's hold ─────────────────────────────────────

  describe("Given a hold placed by the victim platform", () => {
    describe("When the attacker platform attempts to capture the hold", () => {
      it("Then it should return 404 (hold not visible to attacker)", async () => {
        const holdId = await placeHold(walletId, 2000);

        const res = await app.attackerRequest(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });

        expect(res.status).toBe(404);
      });
    });
  });
});
