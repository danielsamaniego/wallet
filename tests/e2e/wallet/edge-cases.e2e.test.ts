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

  // ── Withdraw exact balance (zero remaining) ─────────────────────────────

  describe("Given a wallet with exactly 5000 cents", () => {
    describe("When withdrawing exactly 5000 cents", () => {
      it("Then the withdrawal should succeed and balance should be exactly 0", async () => {
        const walletId = await createWallet("exact-wd-owner");
        await deposit(walletId, 5000);

        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 5000 }),
        });
        expect(res.status).toBe(201);

        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        const wallet = await walletRes.json();
        expect(Number(wallet.balance_cents)).toBe(0);
      });
    });

    describe("When then attempting to withdraw 1 more cent", () => {
      it("Then it should fail with INSUFFICIENT_FUNDS", async () => {
        const walletId = await createWallet("exact-wd-then-1-owner");
        await deposit(walletId, 5000);

        // Drain completely
        const wdRes = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 5000 }),
        });
        expect(wdRes.status).toBe(201);

        // 1 more cent — must fail
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 1 }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("INSUFFICIENT_FUNDS");
      });
    });
  });

  // ── Transfer exact balance ──────────────────────────────────────────────

  describe("Given a wallet with 8000 cents and a target wallet", () => {
    describe("When transferring exactly 8000 cents", () => {
      it("Then the source balance should be 0 and target balance should increase by 8000", async () => {
        const source = await createWallet("exact-xfr-src");
        const target = await createWallet("exact-xfr-tgt");
        await deposit(source, 8000);

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ source_wallet_id: source, target_wallet_id: target, amount_cents: 8000 }),
        });
        expect(res.status).toBe(201);

        const srcRes = await app.request(`/v1/wallets/${source}`);
        expect(Number((await srcRes.json()).balance_cents)).toBe(0);

        const tgtRes = await app.request(`/v1/wallets/${target}`);
        expect(Number((await tgtRes.json()).balance_cents)).toBe(8000);
      });
    });
  });

  // ── Hold for exact available balance, then capture ──────────────────────

  describe("Given a wallet with 6000 cents", () => {
    describe("When placing a hold for exactly 6000 cents and then capturing it", () => {
      it("Then both operations should succeed and final balance should be 0", async () => {
        const walletId = await createWallet("exact-hold-owner");
        await deposit(walletId, 6000);

        // Place hold for full amount
        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_cents: 6000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        // Capture it
        const captureRes = await app.request(`/v1/holds/${hold_id}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        // Balance should be 0 (hold captured = money moved to system wallet)
        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        expect(Number((await walletRes.json()).balance_cents)).toBe(0);
      });
    });
  });

  // ── Multiple holds that exactly exhaust available balance ────────────────

  describe("Given a wallet with 10000 cents", () => {
    describe("When placing 5 holds of 2000 cents each (exactly 10000)", () => {
      it("Then all 5 holds should succeed and a 6th hold of 1 cent should fail", async () => {
        const walletId = await createWallet("multi-hold-exhaust-owner");
        await deposit(walletId, 10000);

        for (let i = 0; i < 5; i++) {
          const res = await app.request("/v1/holds", {
            method: "POST",
            headers: { "Idempotency-Key": nextKey() },
            body: JSON.stringify({ wallet_id: walletId, amount_cents: 2000 }),
          });
          expect(res.status).toBe(201);
        }

        // 6th hold — even 1 cent should be rejected (available = 0)
        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_cents: 1 }),
        });
        expect(res.status).toBe(422);
      });
    });
  });

  // ── Deposit/withdraw/transfer on closed wallet ──────────────────────────

  describe("Given a closed wallet", () => {
    let closedWalletId: string;
    let otherWalletId: string;

    beforeEach(async () => {
      closedWalletId = await createWallet("closed-ops-owner");
      otherWalletId = await createWallet("closed-ops-other");
      await deposit(otherWalletId, 50000);

      // Close the wallet (balance is 0, so closing is allowed)
      const closeRes = await app.request(`/v1/wallets/${closedWalletId}/close`, { method: "POST" });
      expect(closeRes.status).toBe(200);
    });

    describe("When depositing to the closed wallet", () => {
      it("Then it should reject with 422", async () => {
        const res = await app.request(`/v1/wallets/${closedWalletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 1000 }),
        });
        expect(res.status).toBe(422);
      });
    });

    describe("When transferring to the closed wallet", () => {
      it("Then it should reject with 422", async () => {
        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({
            source_wallet_id: otherWalletId,
            target_wallet_id: closedWalletId,
            amount_cents: 1000,
          }),
        });
        expect(res.status).toBe(422);
      });
    });

    describe("When placing a hold on the closed wallet", () => {
      it("Then it should reject with 422", async () => {
        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: closedWalletId, amount_cents: 100 }),
        });
        expect(res.status).toBe(422);
      });
    });
  });

  // ── Void a non-existent hold ────────────────────────────────────────────

  describe("Given a hold ID that does not exist", () => {
    describe("When attempting to void it", () => {
      it("Then it should return 404", async () => {
        const fakeHoldId = "019560a0-0000-7000-8000-000000000066";

        const res = await app.request(`/v1/holds/${fakeHoldId}/void`, { method: "POST" });
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Same owner, multiple currencies ─────────────────────────────────────

  describe("Given the same owner creates wallets in different currencies", () => {
    describe("When creating USD, EUR, and MXN wallets", () => {
      it("Then all three should be created independently", async () => {
        const usd = await createWallet("multi-curr-owner", "USD");
        const eur = await createWallet("multi-curr-owner", "EUR");
        const mxn = await createWallet("multi-curr-owner", "MXN");

        expect(usd).toBeDefined();
        expect(eur).toBeDefined();
        expect(mxn).toBeDefined();
        expect(new Set([usd, eur, mxn]).size).toBe(3);

        // Deposit to each independently
        await deposit(usd, 1000);
        await deposit(eur, 2000);
        await deposit(mxn, 3000);

        const usdRes = await app.request(`/v1/wallets/${usd}`);
        const eurRes = await app.request(`/v1/wallets/${eur}`);
        const mxnRes = await app.request(`/v1/wallets/${mxn}`);

        expect(Number((await usdRes.json()).balance_cents)).toBe(1000);
        expect(Number((await eurRes.json()).balance_cents)).toBe(2000);
        expect(Number((await mxnRes.json()).balance_cents)).toBe(3000);
      });
    });
  });

  // ── Deposit and immediately close (must zero balance first) ─────────────

  describe("Given a wallet with funds", () => {
    describe("When attempting to close it without zeroing the balance", () => {
      it("Then it should reject because balance is not zero", async () => {
        const walletId = await createWallet("close-with-balance-owner");
        await deposit(walletId, 100);

        const res = await app.request(`/v1/wallets/${walletId}/close`, { method: "POST" });
        expect(res.status).toBe(422);
      });
    });
  });

  // ── Transfer between different currencies ───────────────────────────────

  describe("Given a MXN wallet and a EUR wallet from the same owner", () => {
    describe("When attempting a transfer between them", () => {
      it("Then it should reject with a currency mismatch error", async () => {
        const mxn = await createWallet("curr-mismatch-mxn", "MXN");
        const eur = await createWallet("curr-mismatch-eur", "EUR");
        await deposit(mxn, 50000);

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ source_wallet_id: mxn, target_wallet_id: eur, amount_cents: 1000 }),
        });
        expect([400, 422]).toContain(res.status);
      });
    });
  });
});
