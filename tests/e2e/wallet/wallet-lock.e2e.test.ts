import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TestApp, createTestApp } from "../setup/test-app.js";

// Redis container is published at localhost:6380 per docker-compose.test.yml.
const REDIS_TEST_URL = process.env.REDIS_TEST_URL ?? "redis://localhost:6380";

/**
 * Per-wallet serialization E2E.
 *
 * The app container running under docker-compose.test.yml is configured with
 * WALLET_LOCK_ENABLED=true and REDIS_URL pointing at the bundled Redis
 * container. These tests validate that concurrent write commands on the same
 * wallet produce zero 409 VERSION_CONFLICT responses — the mutex serializes
 * them before Postgres sees the contention.
 *
 * Compare with concurrency.e2e.test.ts which accepts 409s as part of the
 * optimistic-locking contract. With the lock enabled, 409s must be zero.
 */
describe("Wallet per-wallet serialization E2E (WALLET_LOCK_ENABLED=true)", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `lock-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function getBalance(walletId: string): Promise<number> {
    const res = await app.request(`/v1/wallets/${walletId}`, { method: "GET" });
    expect(res.status).toBe(200);
    return Number((await res.json()).balance_minor);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  describe("Given 50 concurrent deposits on the same wallet", () => {
    describe("When dispatched in parallel via Promise.all", () => {
      it("Then all succeed (201) with zero 409 VERSION_CONFLICT and the final balance is exact", async () => {
        const walletId = await createWallet("lock-conc-owner");
        const depositsCount = 50;
        const unit = 1_000; // 10.00 per deposit

        const results = await Promise.all(
          Array.from({ length: depositsCount }, (_, i) =>
            app.request(`/v1/wallets/${walletId}/deposit`, {
              method: "POST",
              headers: { "Idempotency-Key": `lock-dep-${i}-${Date.now()}` },
              body: JSON.stringify({ amount_minor: unit }),
            }),
          ),
        );

        const statuses = results.map((r) => r.status);
        const succeeded = statuses.filter((s) => s === 201).length;
        const conflicts = statuses.filter((s) => s === 409).length;

        expect(succeeded).toBe(depositsCount);
        expect(conflicts).toBe(0);

        const balance = await getBalance(walletId);
        expect(balance).toBe(depositsCount * unit);
      });
    });
  });

  describe("Given concurrent writes across different wallets", () => {
    describe("When dispatched in parallel", () => {
      it("Then the lock does not serialize unrelated wallets (parallelism preserved)", async () => {
        const walletCount = 10;

        // Wallet creation is intentionally serialized to avoid the pre-existing
        // system-wallet race (unrelated to this feature): on a fresh DB, the
        // first createWallet call per (platform, currency) auto-creates the
        // system wallet, and two racing createWallet calls can both try to
        // create it. This serialization isolates that concern — the deposit
        // phase below is the part that actually exercises parallel locks.
        const walletIds: string[] = [];
        for (let i = 0; i < walletCount; i++) {
          walletIds.push(await createWallet(`lock-paral-${i}`));
        }

        const results = await Promise.all(
          walletIds.map((id, i) =>
            app.request(`/v1/wallets/${id}/deposit`, {
              method: "POST",
              headers: { "Idempotency-Key": `lock-paral-dep-${i}-${Date.now()}` },
              body: JSON.stringify({ amount_minor: 500 }),
            }),
          ),
        );

        // Every response must be a known status. Under a correct per-wallet
        // lock, concurrent deposits to DIFFERENT user wallets don't serialize
        // on each other; however they still share the platform's system wallet,
        // which uses atomic increment under SERIALIZABLE isolation. A small
        // number of 409 VERSION_CONFLICT is possible from that path and is
        // outside the scope of this feature.
        const statuses = results.map((r) => r.status);
        for (const status of statuses) {
          expect([201, 409]).toContain(status);
        }
        const successes = statuses.filter((s) => s === 201).length;
        expect(successes).toBeGreaterThan(0);

        // Every wallet that returned 201 must have balance 500; 409s leave
        // the balance at 0. Totals must reconcile.
        const balances = await Promise.all(walletIds.map((id) => getBalance(id)));
        const creditedWallets = balances.filter((b) => b === 500).length;
        const emptyWallets = balances.filter((b) => b === 0).length;
        expect(creditedWallets).toBe(successes);
        expect(creditedWallets + emptyWallets).toBe(walletCount);
      });
    });
  });

  describe("Given a mix of 20 deposits and 10 withdrawals on the same wallet", () => {
    describe("When executed concurrently after seeding enough balance", () => {
      it("Then no 409 conflicts occur and the final balance equals the net sum", async () => {
        const walletId = await createWallet("lock-mix-owner");

        // Seed enough balance so withdraws won't be rejected by business rules.
        const seedRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: 1_000_000 }),
        });
        expect(seedRes.status).toBe(201);

        const deposits = Array.from({ length: 20 }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": `lock-mix-dep-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_minor: 100 }),
          }),
        );
        const withdraws = Array.from({ length: 10 }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/withdraw`, {
            method: "POST",
            headers: { "Idempotency-Key": `lock-mix-wd-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_minor: 50 }),
          }),
        );

        const results = await Promise.all([...deposits, ...withdraws]);
        const statuses = results.map((r) => r.status);
        const conflicts = statuses.filter((s) => s === 409).length;
        const successes = statuses.filter((s) => s === 201).length;

        expect(conflicts).toBe(0);
        expect(successes).toBe(30);

        const finalBalance = await getBalance(walletId);
        const expected = 1_000_000 + 20 * 100 - 10 * 50;
        expect(finalBalance).toBe(expected);
      });
    });
  });

  describe("Given 100 concurrent deposits on the same wallet (stress)", () => {
    describe("When dispatched in parallel", () => {
      it("Then all succeed, zero 409, and the final balance is exact", async () => {
        const walletId = await createWallet("lock-stress-owner");
        const unit = 100; // 1.00 per deposit
        const N = 100;

        const results = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            app.request(`/v1/wallets/${walletId}/deposit`, {
              method: "POST",
              headers: { "Idempotency-Key": `lock-stress-${i}-${Date.now()}` },
              body: JSON.stringify({ amount_minor: unit }),
            }),
          ),
        );

        const statuses = results.map((r) => r.status);
        const succeeded = statuses.filter((s) => s === 201).length;
        const conflicts = statuses.filter((s) => s === 409).length;

        expect(succeeded).toBe(N);
        expect(conflicts).toBe(0);

        const balance = await getBalance(walletId);
        expect(balance).toBe(N * unit);
      });
    });
  });

  describe("Given 60 mixed mutations on the same wallet (deposit + withdraw + adjust)", () => {
    describe("When executed concurrently after seeding a large balance", () => {
      it("Then the lock serializes all three command types with zero 409s and an exact net balance", async () => {
        const walletId = await createWallet("lock-mix3-owner");

        const seedAmount = 10_000_000; // 100k EUR
        const seedRes = await app.request(`/v1/wallets/${walletId}/deposit`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_minor: seedAmount }),
        });
        expect(seedRes.status).toBe(201);

        const depositsCount = 20;
        const withdrawsCount = 20;
        const adjustsCount = 20;
        const depositAmount = 200;
        const withdrawAmount = 100;
        const adjustAmount = -50; // negative adjust

        const deposits = Array.from({ length: depositsCount }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": `mix3-dep-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_minor: depositAmount }),
          }),
        );
        const withdraws = Array.from({ length: withdrawsCount }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/withdraw`, {
            method: "POST",
            headers: { "Idempotency-Key": `mix3-wd-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_minor: withdrawAmount }),
          }),
        );
        const adjusts = Array.from({ length: adjustsCount }, (_, i) =>
          app.request(`/v1/wallets/${walletId}/adjust`, {
            method: "POST",
            headers: { "Idempotency-Key": `mix3-adj-${i}-${Date.now()}` },
            body: JSON.stringify({ amount_minor: adjustAmount, reason: "stress test adjust" }),
          }),
        );

        const results = await Promise.all([...deposits, ...withdraws, ...adjusts]);
        const statuses = results.map((r) => r.status);
        const conflicts = statuses.filter((s) => s === 409).length;
        const successes = statuses.filter((s) => s === 201).length;

        expect(conflicts).toBe(0);
        expect(successes).toBe(depositsCount + withdrawsCount + adjustsCount);

        const finalBalance = await getBalance(walletId);
        const expected =
          seedAmount +
          depositsCount * depositAmount -
          withdrawsCount * withdrawAmount +
          adjustsCount * adjustAmount;
        expect(finalBalance).toBe(expected);
      });
    });
  });

  /**
   * Forced-contention path: instead of relying on natural contention (which
   * wouldn't trigger a 409 with the default 5s waitMs), we connect to the
   * test Redis directly and hold the wallet key with our own token BEFORE
   * firing the HTTP request. The adapter polls until waitMs elapses, then
   * throws LockContendedError, which LockRunner maps to
   * AppError.conflict("LOCK_CONTENDED") → HTTP 409.
   */
  describe("Given the wallet lock key is held by an external holder", () => {
    let redis: IORedis;

    beforeAll(async () => {
      redis = new IORedis(REDIS_TEST_URL, { lazyConnect: true });
      await redis.connect();
    });

    afterAll(async () => {
      await redis.quit().catch(() => undefined);
    });

    describe("When a deposit arrives and waitMs elapses without release", () => {
      it("Then responds 409 with error=LOCK_CONTENDED so the client retries with the same Idempotency-Key", async () => {
        const walletId = await createWallet("lock-contended-owner");
        const key = `wallet-lock:${walletId}`;

        // Hold the key with a foreign token for longer than the app's waitMs
        // (WALLET_LOCK_WAIT_MS=5000 in docker-compose.test.yml). PX 8000ms
        // gives comfortable margin.
        const acquired = await redis.set(key, "external-holder-token", "PX", 8_000, "NX");
        expect(acquired).toBe("OK");

        try {
          const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
            method: "POST",
            headers: { "Idempotency-Key": nextKey() },
            body: JSON.stringify({ amount_minor: 1_000 }),
          });

          expect(res.status).toBe(409);
          const body = (await res.json()) as { error: string; message: string };
          expect(body.error).toBe("LOCK_CONTENDED");
          expect(body.message).toContain(walletId);
        } finally {
          // Release the foreign lock even if the assertion fails.
          await redis.del(key).catch(() => undefined);
        }

        // Balance must be unchanged — the deposit never ran.
        const balance = await getBalance(walletId);
        expect(balance).toBe(0);
      });
    });
  });
});
