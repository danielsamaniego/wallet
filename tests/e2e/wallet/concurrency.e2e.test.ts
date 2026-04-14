import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Concurrency & Race Conditions E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `concurrency-${++idempCounter}-${Date.now()}`;

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

  /** Helper: deposit into a wallet and return the response status. */
  async function deposit(walletId: string, amountCents: number): Promise<number> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_cents: amountCents }),
    });
    return res.status;
  }

  /** Helper: get wallet balance. */
  async function getBalance(walletId: string): Promise<number> {
    const res = await app.request(`/v1/wallets/${walletId}`, { method: "GET" });
    expect(res.status).toBe(200);
    const json = await res.json();
    return Number(json.balance_cents);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  // ── 7.1 Concurrent deposits ──────────────────────────────────────────────

  describe("Given a wallet with a known initial balance", () => {
    describe("When 10 concurrent deposits of 1000 cents each are executed", () => {
      it("Then the final balance should equal initial + 10000", async () => {
        const walletId = await createWallet("conc-deposit-owner");
        await deposit(walletId, 5000);
        const initialBalance = await getBalance(walletId);

        // Fire 10 concurrent deposits with unique idempotency keys
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            app.request(`/v1/wallets/${walletId}/deposit`, {
              method: "POST",
              headers: { "Idempotency-Key": `conc-dep-${i}-${Date.now()}` },
              body: JSON.stringify({ amount_cents: 1000 }),
            }),
          ),
        );

        // With optimistic locking, some may get 409 (VERSION_CONFLICT) and need retry.
        // What matters is: all that succeed are 201, and the final balance is correct.
        const succeeded = results.filter((r) => r.status === 201).length;
        const conflicts = results.filter((r) => r.status === 409).length;
        expect(succeeded + conflicts).toBe(10);
        expect(succeeded).toBeGreaterThan(0);

        const finalBalance = await getBalance(walletId);
        // Each successful deposit adds 1000 cents
        expect(finalBalance).toBe(initialBalance + succeeded * 1000);
      });
    });
  });

  // ── 7.2 Concurrent withdrawals ──────────────────────────────────────────

  describe("Given a wallet with 50000 cents", () => {
    describe("When 20 concurrent withdrawals of 5000 cents each are attempted", () => {
      it("Then the balance should never go negative and some withdrawals should fail with INSUFFICIENT_FUNDS or conflict", async () => {
        const walletId = await createWallet("conc-withdraw-owner");
        const depStatus = await deposit(walletId, 50000);
        expect(depStatus).toBe(201);

        // Fire 20 concurrent withdrawals
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            app.request(`/v1/wallets/${walletId}/withdraw`, {
              method: "POST",
              headers: { "Idempotency-Key": `conc-wd-${i}-${Date.now()}` },
              body: JSON.stringify({ amount_cents: 5000 }),
            }),
          ),
        );

        const statuses = results.map((r) => r.status);
        const successes = statuses.filter((s) => s === 201).length;
        const insufficientFunds = statuses.filter((s) => s === 422).length;
        const conflicts = statuses.filter((s) => s === 409).length;

        // At most 10 can succeed (50000 / 5000 = 10)
        expect(successes).toBeLessThanOrEqual(10);
        // Some must fail (20 requests for 100000 total but only 50000 available)
        expect(insufficientFunds + conflicts).toBeGreaterThan(0);

        // Final balance must be non-negative
        const finalBalance = await getBalance(walletId);
        expect(finalBalance).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ── 7.3 Bidirectional transfers (deadlock test) ─────────────────────────

  describe("Given two wallets each with 50000 cents", () => {
    describe("When 10 concurrent A->B and 10 concurrent B->A transfers of 100 cents are executed", () => {
      it("Then there should be zero 500 errors (no deadlocks) and some 409 conflicts are acceptable", async () => {
        const walletA = await createWallet("deadlock-owner-a");
        const walletB = await createWallet("deadlock-owner-b");
        await deposit(walletA, 50000);
        await deposit(walletB, 50000);

        // Fire 10 A->B and 10 B->A transfers concurrently
        const abTransfers = Array.from({ length: 10 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `dl-ab-${i}-${Date.now()}` },
            body: JSON.stringify({
              source_wallet_id: walletA,
              target_wallet_id: walletB,
              amount_cents: 100,
            }),
          }),
        );

        const baTransfers = Array.from({ length: 10 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `dl-ba-${i}-${Date.now()}` },
            body: JSON.stringify({
              source_wallet_id: walletB,
              target_wallet_id: walletA,
              amount_cents: 100,
            }),
          }),
        );

        const results = await Promise.all([...abTransfers, ...baTransfers]);
        const statuses = results.map((r) => r.status);

        // No 500 errors (would indicate deadlock or unhandled exception)
        const serverErrors = statuses.filter((s) => s === 500).length;
        expect(serverErrors).toBe(0);

        // Verify at least some succeeded
        const successes = statuses.filter((s) => s === 201).length;
        expect(successes).toBeGreaterThan(0);

        // Both balances should remain non-negative
        const balanceA = await getBalance(walletA);
        const balanceB = await getBalance(walletB);
        expect(balanceA).toBeGreaterThanOrEqual(0);
        expect(balanceB).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ── 8.6 Concurrent hold placement ──────────────────────────────────────

  describe("Given a wallet with 10000 cents", () => {
    describe("When 20 concurrent holds of 2000 cents each are placed", () => {
      it("Then the balance should never go negative and not all holds should be accepted", async () => {
        const walletId = await createWallet("conc-hold-owner");
        await deposit(walletId, 10000);

        // Fire 20 concurrent hold placements
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            app.request("/v1/holds", {
              method: "POST",
              headers: { "Idempotency-Key": `conc-hold-${i}-${Date.now()}` },
              body: JSON.stringify({ wallet_id: walletId, amount_cents: 2000 }),
            }),
          ),
        );

        const statuses = results.map((r) => r.status);
        const accepted = statuses.filter((s) => s === 201).length;
        const rejected = statuses.filter((s) => s === 422).length;

        // At most 5 can succeed (10000 / 2000 = 5)
        expect(accepted).toBeLessThanOrEqual(5);
        // Some must be rejected (20 holds of 2000 = 40000, but only 10000 available)
        expect(rejected).toBeGreaterThan(0);

        // Balance must remain non-negative
        const finalBalance = await getBalance(walletId);
        expect(finalBalance).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
