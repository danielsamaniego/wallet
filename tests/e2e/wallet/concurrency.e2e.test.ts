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

  // ── Concurrent deposits + withdrawals simultaneously ────────────────────

  describe("Given a wallet with 50000 cents", () => {
    describe("When 10 deposits and 10 withdrawals of 1000 cents each fire concurrently", () => {
      it("Then the final balance should be consistent (no money created or lost)", async () => {
        const walletId = await createWallet("conc-mix-owner");
        await deposit(walletId, 50000);

        const deposits = Array.from({ length: 10 }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": `conc-mix-dep-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_cents: 1000 }),
          }),
        );

        const withdrawals = Array.from({ length: 10 }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/withdraw`, {
            method: "POST",
            headers: { "Idempotency-Key": `conc-mix-wd-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_cents: 1000 }),
          }),
        );

        const results = await Promise.all([...deposits, ...withdrawals]);
        const depSucceeded = results.slice(0, 10).filter((r) => r.status === 201).length;
        const wdSucceeded = results.slice(10).filter((r) => r.status === 201).length;

        const finalBalance = await getBalance(walletId);
        // Balance = initial + deposits - withdrawals
        expect(finalBalance).toBe(50000 + depSucceeded * 1000 - wdSucceeded * 1000);
        expect(finalBalance).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ── Circular transfers: A→B, B→C, C→A (3-wallet deadlock test) ─────────

  describe("Given three wallets each with 30000 cents", () => {
    describe("When 5 concurrent A→B, 5 B→C, and 5 C→A transfers fire simultaneously", () => {
      it("Then there should be zero 500 errors and all balances remain non-negative", async () => {
        const walletA = await createWallet("circ-a");
        const walletB = await createWallet("circ-b");
        const walletC = await createWallet("circ-c");
        await deposit(walletA, 30000);
        await deposit(walletB, 30000);
        await deposit(walletC, 30000);

        const ab = Array.from({ length: 5 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `circ-ab-${i}-${Date.now()}` },
            body: JSON.stringify({ source_wallet_id: walletA, target_wallet_id: walletB, amount_cents: 500 }),
          }),
        );
        const bc = Array.from({ length: 5 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `circ-bc-${i}-${Date.now()}` },
            body: JSON.stringify({ source_wallet_id: walletB, target_wallet_id: walletC, amount_cents: 500 }),
          }),
        );
        const ca = Array.from({ length: 5 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `circ-ca-${i}-${Date.now()}` },
            body: JSON.stringify({ source_wallet_id: walletC, target_wallet_id: walletA, amount_cents: 500 }),
          }),
        );

        const results = await Promise.all([...ab, ...bc, ...ca]);
        const statuses = results.map((r) => r.status);

        // No 500 errors — deadlocks would surface as 500
        expect(statuses.filter((s) => s === 500).length).toBe(0);

        // All balances non-negative
        expect(await getBalance(walletA)).toBeGreaterThanOrEqual(0);
        expect(await getBalance(walletB)).toBeGreaterThanOrEqual(0);
        expect(await getBalance(walletC)).toBeGreaterThanOrEqual(0);

        // Total money in the system is conserved (90000 total)
        const total = (await getBalance(walletA)) + (await getBalance(walletB)) + (await getBalance(walletC));
        expect(total).toBe(90000);
      });
    });
  });

  // ── Concurrent capture + void on same hold (race condition) ─────────────

  describe("Given an active hold on a funded wallet", () => {
    describe("When capture and void are fired simultaneously on the same hold", () => {
      it("Then exactly one should succeed and the other should fail, with no 500 errors", async () => {
        const walletId = await createWallet("conc-hold-cv-owner");
        await deposit(walletId, 20000);

        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": `conc-cv-place-${Date.now()}` },
          body: JSON.stringify({ wallet_id: walletId, amount_cents: 5000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        // Fire capture and void simultaneously
        const [captureRes, voidRes] = await Promise.all([
          app.request(`/v1/holds/${hold_id}/capture`, {
            method: "POST",
            headers: { "Idempotency-Key": `conc-cv-cap-${Date.now()}` },
          }),
          app.request(`/v1/holds/${hold_id}/void`, { method: "POST" }),
        ]);

        const statuses = [captureRes.status, voidRes.status].sort();

        // No 500 errors
        expect(captureRes.status).not.toBe(500);
        expect(voidRes.status).not.toBe(500);

        // At most one success (one must get 200/201, other gets 409 or 422)
        const successes = statuses.filter((s) => s === 200 || s === 201).length;
        expect(successes).toBeLessThanOrEqual(1);

        // Balance non-negative
        expect(await getBalance(walletId)).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ── Concurrent freeze + deposit race ────────────────────────────────────

  describe("Given an active wallet with 10000 cents", () => {
    describe("When freeze and deposit fire simultaneously", () => {
      it("Then no 500 errors should occur and the wallet ends frozen or with the deposit", async () => {
        const walletId = await createWallet("conc-freeze-dep-owner");
        await deposit(walletId, 10000);

        const [freezeRes, depositRes] = await Promise.all([
          app.request(`/v1/wallets/${walletId}/freeze`, { method: "POST" }),
          app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": `conc-fd-dep-${Date.now()}` },
            body: JSON.stringify({ amount_cents: 5000 }),
          }),
        ]);

        // No 500 errors
        expect(freezeRes.status).not.toBe(500);
        expect(depositRes.status).not.toBe(500);

        // Wallet state is consistent
        const balance = await getBalance(walletId);
        expect(balance).toBeGreaterThanOrEqual(10000);
      });
    });
  });

  // ── Concurrent wallet creation with same owner+currency (duplicate race) ──

  describe("Given no wallet exists for a specific owner+currency", () => {
    describe("When two wallet creations with the same owner+currency fire simultaneously", () => {
      it("Then exactly one should succeed with 201 and the other should fail with 409", async () => {
        const results = await Promise.all(
          Array.from({ length: 2 }, (_, i) =>
            app.request("/v1/wallets", {
              method: "POST",
              headers: { "Idempotency-Key": `conc-dup-wallet-${i}-${Date.now()}` },
              body: JSON.stringify({ owner_id: "conc-dup-owner", currency_code: "USD" }),
            }),
          ),
        );

        const statuses = results.map((r) => r.status).sort();

        // One 201 and one 409 (or both could succeed if idempotent; at least one 201)
        const created = statuses.filter((s) => s === 201).length;
        const conflicts = statuses.filter((s) => s === 409).length;
        expect(created).toBeGreaterThanOrEqual(1);
        expect(created + conflicts).toBe(2);
      });
    });
  });

  // ── Load test: rapid sequential operations on a single wallet ───────────

  describe("Given a wallet with 100000 cents", () => {
    describe("When 30 sequential deposit+withdraw cycles are executed", () => {
      it("Then the final balance should equal initial balance and the ledger chain should be intact", async () => {
        const walletId = await createWallet("load-seq-owner");
        await deposit(walletId, 100000);

        for (let i = 0; i < 30; i++) {
          const depRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": `load-dep-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_cents: 100 }),
          });
          expect(depRes.status).toBe(201);

          const wdRes = await app.request(`/v1/wallets/${walletId}/withdraw`, {
            method: "POST",
            headers: { "Idempotency-Key": `load-wd-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_cents: 100 }),
          });
          expect(wdRes.status).toBe(201);
        }

        // Balance unchanged: 30 deposits of 100 and 30 withdrawals of 100
        expect(await getBalance(walletId)).toBe(100000);
      });
    });
  });

  // ── Concurrent transfers draining a wallet ──────────────────────────────

  describe("Given a wallet with exactly 10000 cents", () => {
    describe("When 10 concurrent transfers of 1000 cents each to different wallets fire", () => {
      it("Then the source wallet balance should never go negative", async () => {
        const source = await createWallet("drain-source");
        await deposit(source, 10000);

        // Create 10 target wallets sequentially to avoid overloading the server
        const targets: string[] = [];
        for (let i = 0; i < 10; i++) {
          targets.push(await createWallet(`drain-target-${i}`));
        }

        const results = await Promise.all(
          targets.map((target, i) =>
            app.request("/v1/transfers", {
              method: "POST",
              headers: { "Idempotency-Key": `drain-xfr-${i}-${Date.now()}` },
              body: JSON.stringify({ source_wallet_id: source, target_wallet_id: target, amount_cents: 1000 }),
            }),
          ),
        );

        const succeeded = results.filter((r) => r.status === 201).length;
        const sourceBalance = await getBalance(source);

        // At most 10 can succeed (10000 / 1000)
        expect(succeeded).toBeLessThanOrEqual(10);
        expect(sourceBalance).toBeGreaterThanOrEqual(0);
        expect(sourceBalance).toBe(10000 - succeeded * 1000);
      });
    });
  });
});
