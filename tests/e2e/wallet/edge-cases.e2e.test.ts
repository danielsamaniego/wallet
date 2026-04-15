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
  async function deposit(walletId: string, amountMinor: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_minor: amountMinor }),
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
          body: JSON.stringify({ amount_minor: 1 }),
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
          body: JSON.stringify({ amount_minor: 1 }),
        });

        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        expect(walletRes.status).toBe(200);
        const wallet = await walletRes.json();
        expect(Number(wallet.balance_minor)).toBe(1);
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
            amount_minor: 1000,
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
          body: JSON.stringify({ amount_minor: 1000 }),
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
            amount_minor: 1000,
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
          body: JSON.stringify({ amount_minor: 5000 }),
        });
        expect(res.status).toBe(201);

        const walletRes = await app.request(`/v1/wallets/${walletId}`);
        const wallet = await walletRes.json();
        expect(Number(wallet.balance_minor)).toBe(0);
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
          body: JSON.stringify({ amount_minor: 5000 }),
        });
        expect(wdRes.status).toBe(201);

        // 1 more cent — must fail
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 1 }),
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
          body: JSON.stringify({ source_wallet_id: source, target_wallet_id: target, amount_minor: 8000 }),
        });
        expect(res.status).toBe(201);

        const srcRes = await app.request(`/v1/wallets/${source}`);
        expect(Number((await srcRes.json()).balance_minor)).toBe(0);

        const tgtRes = await app.request(`/v1/wallets/${target}`);
        expect(Number((await tgtRes.json()).balance_minor)).toBe(8000);
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
          body: JSON.stringify({ wallet_id: walletId, amount_minor: 6000 }),
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
        expect(Number((await walletRes.json()).balance_minor)).toBe(0);
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
            body: JSON.stringify({ wallet_id: walletId, amount_minor: 2000 }),
          });
          expect(res.status).toBe(201);
        }

        // 6th hold — even 1 cent should be rejected (available = 0)
        const res = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletId, amount_minor: 1 }),
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
          body: JSON.stringify({ amount_minor: 1000 }),
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
            amount_minor: 1000,
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
          body: JSON.stringify({ wallet_id: closedWalletId, amount_minor: 100 }),
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

        expect(Number((await usdRes.json()).balance_minor)).toBe(1000);
        expect(Number((await eurRes.json()).balance_minor)).toBe(2000);
        expect(Number((await mxnRes.json()).balance_minor)).toBe(3000);
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
          body: JSON.stringify({ source_wallet_id: mxn, target_wallet_id: eur, amount_minor: 1000 }),
        });
        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── Operations with zero-decimal currency (CLP, minorUnit=0) ──────────

  describe("Given a CLP wallet (zero-decimal currency)", () => {
    describe("When performing deposit, withdrawal, and transfer operations", () => {
      it("Then all operations should work correctly with whole units", async () => {
        const clp1 = await createWallet("clp-ops-owner-1", "CLP");
        const clp2 = await createWallet("clp-ops-owner-2", "CLP");

        // Deposit 50000 CLP (= 50000 CLP, no decimals)
        await deposit(clp1, 50000);
        const w1 = await (await app.request(`/v1/wallets/${clp1}`)).json();
        expect(Number(w1.balance_minor)).toBe(50000);
        expect(w1.currency_code).toBe("CLP");

        // Withdraw 10000 CLP
        const wdRes = await app.request(`/v1/wallets/${clp1}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 10000 }),
        });
        expect(wdRes.status).toBe(201);

        // Transfer 5000 CLP between CLP wallets
        await deposit(clp2, 1000);
        const trRes = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ source_wallet_id: clp1, target_wallet_id: clp2, amount_minor: 5000 }),
        });
        expect(trRes.status).toBe(201);

        // Verify final balances: clp1 = 50000 - 10000 - 5000 = 35000, clp2 = 1000 + 5000 = 6000
        const final1 = await (await app.request(`/v1/wallets/${clp1}`)).json();
        const final2 = await (await app.request(`/v1/wallets/${clp2}`)).json();
        expect(Number(final1.balance_minor)).toBe(35000);
        expect(Number(final2.balance_minor)).toBe(6000);
      });
    });

    describe("When placing and capturing a hold", () => {
      it("Then the hold lifecycle works correctly", async () => {
        const clpWallet = await createWallet("clp-hold-owner", "CLP");
        await deposit(clpWallet, 100000);

        // Place hold for 30000 CLP
        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: clpWallet, amount_minor: 30000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        // Available balance should reflect the hold
        const walletRes = await (await app.request(`/v1/wallets/${clpWallet}`)).json();
        expect(Number(walletRes.available_balance_minor)).toBe(70000);

        // Capture the hold
        const captureRes = await app.request(`/v1/holds/${hold_id}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        // Balance should now be reduced
        const finalRes = await (await app.request(`/v1/wallets/${clpWallet}`)).json();
        expect(Number(finalRes.balance_minor)).toBe(70000);
      });
    });
  });

  // ── Operations with three-decimal currency (KWD, minorUnit=3) ────────

  describe("Given a KWD wallet (three-decimal currency)", () => {
    describe("When performing deposit, withdrawal, and transfer operations", () => {
      it("Then all operations should work correctly with fils (1/1000 dinar)", async () => {
        const kwd1 = await createWallet("kwd-ops-owner-1", "KWD");
        const kwd2 = await createWallet("kwd-ops-owner-2", "KWD");

        // Deposit 1500 fils = 1.500 KWD
        await deposit(kwd1, 1500);
        const w1 = await (await app.request(`/v1/wallets/${kwd1}`)).json();
        expect(Number(w1.balance_minor)).toBe(1500);
        expect(w1.currency_code).toBe("KWD");

        // Withdraw 500 fils = 0.500 KWD
        const wdRes = await app.request(`/v1/wallets/${kwd1}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 500 }),
        });
        expect(wdRes.status).toBe(201);

        // Transfer 250 fils between KWD wallets
        await deposit(kwd2, 100);
        const trRes = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ source_wallet_id: kwd1, target_wallet_id: kwd2, amount_minor: 250 }),
        });
        expect(trRes.status).toBe(201);

        // Verify final balances: kwd1 = 1500 - 500 - 250 = 750, kwd2 = 100 + 250 = 350
        const final1 = await (await app.request(`/v1/wallets/${kwd1}`)).json();
        const final2 = await (await app.request(`/v1/wallets/${kwd2}`)).json();
        expect(Number(final1.balance_minor)).toBe(750);
        expect(Number(final2.balance_minor)).toBe(350);
      });
    });

    describe("When placing and voiding a hold", () => {
      it("Then the hold lifecycle works correctly", async () => {
        const kwdWallet = await createWallet("kwd-hold-owner", "KWD");
        await deposit(kwdWallet, 5000);

        // Place hold for 2000 fils = 2.000 KWD
        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: kwdWallet, amount_minor: 2000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        // Available balance should reflect the hold
        const walletRes = await (await app.request(`/v1/wallets/${kwdWallet}`)).json();
        expect(Number(walletRes.available_balance_minor)).toBe(3000);

        // Void the hold — balance should be fully restored
        const voidRes = await app.request(`/v1/holds/${hold_id}/void`, { method: "POST" });
        expect(voidRes.status).toBe(200);

        const finalRes = await (await app.request(`/v1/wallets/${kwdWallet}`)).json();
        expect(Number(finalRes.balance_minor)).toBe(5000);
        expect(Number(finalRes.available_balance_minor)).toBe(5000);
      });
    });
  });

  // ── Cross-currency rejection with new currencies ──────────────────────

  describe("Given a CLP wallet and a KWD wallet", () => {
    describe("When attempting a transfer between them", () => {
      it("Then it should reject with currency mismatch", async () => {
        const clp = await createWallet("cross-clp-kwd-1", "CLP");
        const kwd = await createWallet("cross-clp-kwd-2", "KWD");
        await deposit(clp, 10000);

        const res = await app.request("/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ source_wallet_id: clp, target_wallet_id: kwd, amount_minor: 1000 }),
        });
        expect([400, 422]).toContain(res.status);
      });
    });
  });

  // ── GET /v1/currencies ──────────────────────────────────────────────────

  describe("Given the currencies endpoint", () => {
    describe("When requesting supported currencies", () => {
      it("Then it returns 200 with all supported currencies", async () => {
        const res = await app.request("/v1/currencies");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.currencies).toEqual([
          { code: "USD", minor_unit: 2 },
          { code: "EUR", minor_unit: 2 },
          { code: "MXN", minor_unit: 2 },
          { code: "CLP", minor_unit: 0 },
          { code: "KWD", minor_unit: 3 },
        ]);
      });
    });
  });
});
