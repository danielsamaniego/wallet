import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Hold Exploitation E2E", () => {
  let app: TestApp;
  let walletId: string;
  let idempCounter = 0;

  const nextKey = () => `hold-exploit-${++idempCounter}`;

  /** Helper: create a wallet and deposit a known balance. */
  async function setupFundedWallet(balanceMinor = 10000): Promise<string> {
    const createRes = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: "hold-test-owner", currency_code: "USD" }),
    });
    const { wallet_id } = await createRes.json();

    await app.request(`/v1/wallets/${wallet_id}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_minor: balanceMinor }),
    });

    return wallet_id;
  }

  /** Helper: place a hold and return the hold_id. */
  async function placeHold(wId: string, amountMinor: number, expiresAt?: number): Promise<string> {
    const body: Record<string, unknown> = { wallet_id: wId, amount_minor: amountMinor };
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
          body: JSON.stringify({ amount_minor: 10000 }),
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
          body: JSON.stringify({ amount_minor: 7000 }),
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
            amount_minor: 1000,
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
            amount_minor: 10001,
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

  // ── Double void prevention ──────────────────────────────────────────────

  describe("Given a voided hold", () => {
    describe("When attempting to void it a second time", () => {
      it("Then it should return 422 (hold not active)", async () => {
        const holdId = await placeHold(walletId, 2000);

        const first = await app.request(`/v1/holds/${holdId}/void`, { method: "POST" });
        expect(first.status).toBe(200);

        const second = await app.request(`/v1/holds/${holdId}/void`, { method: "POST" });
        expect(second.status).toBe(422);
      });
    });
  });

  // ── Hold on zero-balance wallet ─────────────────────────────────────────

  describe("Given a wallet with zero balance", () => {
    describe("When placing a hold for 1 cent", () => {
      it("Then it should return 422 (insufficient available balance)", async () => {
        // Create a wallet without depositing anything (balance = 0)
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "hold-zero-balance-owner", currency_code: "USD" }),
        });
        const { wallet_id: emptyWallet } = await createRes.json();

        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: emptyWallet, amount_minor: 1 }),
        });

        expect(res.status).toBe(422);
      });
    });
  });

  // ── Multiple holds, capture one, verify others still active ─────────────

  describe("Given a wallet with 10000 cents and three holds of 2000 each", () => {
    describe("When capturing only the first hold", () => {
      it("Then the other two holds should remain active and available balance should reflect them", async () => {
        const holdA = await placeHold(walletId, 2000);
        const holdB = await placeHold(walletId, 2000);
        const holdC = await placeHold(walletId, 2000);

        // Capture hold A
        const captureRes = await app.request(`/v1/holds/${holdA}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        // Wallet balance: 10000 - 2000 (captured) = 8000
        // Available: 8000 - 2000 (holdB) - 2000 (holdC) = 4000
        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        const wallet = await walletRes.json();
        expect(Number(wallet.balance_minor)).toBe(8000);
        expect(Number(wallet.available_balance_minor)).toBe(4000);

        // Hold B and C can still be voided
        const voidB = await app.request(`/v1/holds/${holdB}/void`, { method: "POST" });
        expect(voidB.status).toBe(200);

        const voidC = await app.request(`/v1/holds/${holdC}/void`, { method: "POST" });
        expect(voidC.status).toBe(200);

        // After voiding remaining holds, available = balance = 8000
        const finalRes = await app.request(`/v1/wallets/${walletId}`);
        const finalWallet = await finalRes.json();
        expect(Number(finalWallet.available_balance_minor)).toBe(8000);
      });
    });
  });

  // ── Hold + withdraw race: withdraw reduces balance below hold ───────────

  describe("Given a wallet with 10000 cents and a hold of 3000 cents", () => {
    describe("When withdrawing 7000 cents (leaving 0 available) and then trying to capture the hold", () => {
      it("Then capture should still succeed because the hold was already reserved", async () => {
        const holdId = await placeHold(walletId, 3000);

        // Withdraw all available (10000 - 3000 hold = 7000 available)
        const wdRes = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 7000 }),
        });
        expect(wdRes.status).toBe(201);

        // Capture the hold (balance is 3000, hold is 3000 — should succeed)
        const captureRes = await app.request(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        // Balance should be 0 (3000 - 3000 captured)
        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        expect(Number((await walletRes.json()).balance_minor)).toBe(0);
      });
    });
  });

  // ── Hold, deposit, then capture ─────────────────────────────────────────

  describe("Given a wallet with 5000 cents and a hold of 3000 cents", () => {
    describe("When depositing 2000 more cents and then capturing the hold", () => {
      it("Then the final balance should be 4000 (5000 + 2000 - 3000)", async () => {
        // Use a unique owner to avoid conflict with beforeEach's "hold-test-owner"
        const createRes = await app.request("/v1/wallets", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ owner_id: "hold-dep-cap-owner", currency_code: "USD" }),
        });
        const { wallet_id: w } = await createRes.json();

        await app.request(`/v1/wallets/${w}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 5000 }),
        });

        const holdId = await placeHold(w, 3000);

        // Deposit more
        await app.request(`/v1/wallets/${w}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 2000 }),
        });

        // Capture
        const captureRes = await app.request(`/v1/holds/${holdId}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        const walletRes = await app.request(`/v1/wallets/${w}`);
        expect(Number((await walletRes.json()).balance_minor)).toBe(4000);
      });
    });
  });

  // ── Hold on frozen wallet ───────────────────────────────────────────────

  describe("Given a frozen wallet with funds", () => {
    describe("When attempting to place a hold", () => {
      it("Then it should return 422 WALLET_NOT_ACTIVE", async () => {
        // Freeze the wallet
        const freezeRes = await app.request(`/v1/wallets/${walletId}/freeze`, { method: "POST" });
        expect(freezeRes.status).toBe(200);

        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_minor: 1000 }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("WALLET_NOT_ACTIVE");
      });
    });
  });

  // ── Void a hold then place a new one with the freed amount ──────────────

  describe("Given a wallet at max hold capacity (10000 held of 10000 balance)", () => {
    describe("When voiding a hold and immediately placing a new one", () => {
      it("Then the new hold should succeed because the voided amount is available again", async () => {
        // Exhaust available balance with holds
        const holdA = await placeHold(walletId, 5000);
        await placeHold(walletId, 5000);

        // Available is now 0 — another hold should fail
        const failRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_minor: 1 }),
        });
        expect(failRes.status).toBe(422);

        // Void hold A → 5000 available again
        const voidRes = await app.request(`/v1/holds/${holdA}/void`, { method: "POST" });
        expect(voidRes.status).toBe(200);

        // New hold for 5000 should succeed
        const newHoldRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_minor: 5000 }),
        });
        expect(newHoldRes.status).toBe(201);
      });
    });
  });
});
