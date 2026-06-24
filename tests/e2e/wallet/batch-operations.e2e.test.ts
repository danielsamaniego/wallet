import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { getTestPrisma } from "@test/helpers/db.js";

const PATH = "/v1/wallets/batch-operations";

describe("Batch operations E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `batch-${++idempCounter}-${Date.now()}`;

  type Req = (path: string, init?: RequestInit) => Promise<Response>;

  async function createWallet(
    ownerId: string,
    currency = "EUR",
    req: Req = app.request,
  ): Promise<string> {
    const res = await req("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function deposit(walletId: string, amountMinor: number, req: Req = app.request): Promise<void> {
    const res = await req(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
  }

  async function getBalance(walletId: string, req: Req = app.request): Promise<number> {
    const res = await req(`/v1/wallets/${walletId}`);
    expect(res.status).toBe(200);
    return Number((await res.json()).balance_minor);
  }

  function post(body: unknown, key = nextKey(), req = app.request) {
    return req(PATH, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  }

  // Posts a batch and retries on 409 (LOCK_CONTENDED / VERSION_CONFLICT) reusing
  // the SAME idempotency key — exactly what a well-behaved client does. Lets a
  // concurrency test assert eventual convergence rather than a racy snapshot.
  async function postRetry(body: unknown, req: Req = app.request, tries = 12): Promise<Response> {
    const key = nextKey();
    let res = await post(body, key, req);
    for (let i = 0; res.status === 409 && i < tries; i++) {
      await new Promise((r) => setTimeout(r, 40));
      res = await post(body, key, req);
    }
    return res;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── Happy path: settlement-shaped batch ──────────────────────────────────

  describe("Given a vendor wallet with 0 balance", () => {
    let vendor: string;
    beforeEach(async () => {
      vendor = await createWallet("vendor-settlement");
    });

    describe("When applying a settlement (deposit sale, charge commission + holdback) atomically", () => {
      it("Then it returns 201 with one movement+transaction per operation", async () => {
        const res = await post({
          operations: [
            { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
            { wallet_id: vendor, type: "charge", amount_minor: 1500, reason: "commission" },
            { wallet_id: vendor, type: "charge", amount_minor: 500, reason: "holdback" },
          ],
          reference: "settlement-1",
          metadata: { settlementId: "s-1" },
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.operations).toHaveLength(3);
        for (const o of body.operations) {
          expect(o.movement_id).toBeDefined();
          expect(o.transaction_id).toBeDefined();
        }
      });

      it("Then the wallet balance reflects the net of all operations", async () => {
        await post({
          operations: [
            { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
            { wallet_id: vendor, type: "charge", amount_minor: 1500, reason: "commission" },
            { wallet_id: vendor, type: "charge", amount_minor: 500, reason: "holdback" },
          ],
        });

        // 10000 - 1500 - 500 = 8000
        expect(await getBalance(vendor)).toBe(8000);
      });

      it("Then each operation produces its own normal movement (no synthetic grouping type)", async () => {
        const res = await post({
          operations: [
            { wallet_id: vendor, type: "deposit", amount_minor: 10000 },
            { wallet_id: vendor, type: "charge", amount_minor: 1500 },
          ],
        });
        const { operations } = await res.json();

        const prisma = getTestPrisma();
        const movements = await prisma.movement.findMany({
          where: { id: { in: operations.map((o: { movement_id: string }) => o.movement_id) } },
        });
        expect(movements.map((m) => m.type).sort()).toEqual(["charge", "deposit"]);
      });
    });
  });

  // ── Per-operation metadata ───────────────────────────────────────────────

  describe("Given a batch where each operation carries its own metadata", () => {
    it("Then each transaction stores its op metadata merged over the batch metadata (op wins)", async () => {
      const vendor = await createWallet("vendor-meta");

      const res = await post({
        operations: [
          {
            wallet_id: vendor,
            type: "deposit",
            amount_minor: 10000,
            metadata: { reasonKey: "SETTLEMENT_SALES", k: "op" },
          },
          {
            wallet_id: vendor,
            type: "charge",
            amount_minor: 1500,
            metadata: { reasonKey: "SALES_COMMISSION" },
          },
        ],
        metadata: { correlationId: "c-1", k: "batch" },
      });
      expect(res.status).toBe(201);
      const { operations } = await res.json();

      const prisma = getTestPrisma();
      const txs = await prisma.transaction.findMany({
        where: { id: { in: operations.map((o: { transaction_id: string }) => o.transaction_id) } },
      });
      const byType = new Map(txs.map((t) => [t.type, t.metadata]));
      // deposit op overrides the batch "k"; correlationId (batch-only) is preserved.
      expect(byType.get("deposit")).toEqual({
        correlationId: "c-1",
        k: "op",
        reasonKey: "SETTLEMENT_SALES",
      });
      // charge op has no "k" → keeps the batch "k"; adds its own reasonKey.
      expect(byType.get("charge")).toEqual({
        correlationId: "c-1",
        k: "batch",
        reasonKey: "SALES_COMMISSION",
      });
    });

    it("Then an operation without metadata still inherits the batch metadata", async () => {
      const vendor = await createWallet("vendor-meta-2");

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 5000, metadata: { reasonKey: "A" } },
          { wallet_id: vendor, type: "deposit", amount_minor: 1000 },
        ],
        metadata: { correlationId: "c-2" },
      });
      const { operations } = await res.json();

      const prisma = getTestPrisma();
      const txs = await prisma.transaction.findMany({
        where: { id: { in: operations.map((o: { transaction_id: string }) => o.transaction_id) } },
      });
      const t5000 = txs.find((t) => t.amountMinor === 5000n);
      const t1000 = txs.find((t) => t.amountMinor === 1000n);
      expect(t5000?.metadata).toEqual({ correlationId: "c-2", reasonKey: "A" });
      expect(t1000?.metadata).toEqual({ correlationId: "c-2" });
    });
  });

  // ── Credit-before-debit ordering ─────────────────────────────────────────

  describe("Given a wallet with 0 balance and a debit operation listed before the funding credit", () => {
    it("Then the credit funds the debit and the batch succeeds", async () => {
      const vendor = await createWallet("vendor-ordering");

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "charge", amount_minor: 4000, reason: "commission" },
          { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
        ],
      });

      expect(res.status).toBe(201);
      expect(await getBalance(vendor)).toBe(6000);
    });
  });

  // ── Atomicity: all-or-nothing on insufficient funds ──────────────────────

  describe("Given the net of the operations would drive the wallet negative", () => {
    it("Then it rejects with 422 INSUFFICIENT_FUNDS and applies nothing", async () => {
      const vendor = await createWallet("vendor-atomic");
      await deposit(vendor, 1000);

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 5000, reason: "sale" },
          { wallet_id: vendor, type: "charge", amount_minor: 20000, reason: "commission" },
        ],
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
      // Atomic: the deposit operation must NOT have landed.
      expect(await getBalance(vendor)).toBe(1000);
    });
  });

  // ── Ledger integrity: each movement is balanced (zero-sum) ───────────────

  describe("Given a posted batch", () => {
    it("Then every movement has two ledger entries that sum to zero", async () => {
      const vendor = await createWallet("vendor-ledger");

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
          { wallet_id: vendor, type: "charge", amount_minor: 2000, reason: "commission" },
        ],
      });
      const { operations } = await res.json();

      const prisma = getTestPrisma();
      for (const o of operations) {
        const entries = await prisma.ledgerEntry.findMany({
          where: { movementId: o.movement_id },
        });
        expect(entries).toHaveLength(2);
        expect(entries.reduce((acc, e) => acc + e.amountMinor, 0n)).toBe(0n);
      }
    });
  });

  // ── Idempotency: replay returns cached response, applies once ────────────

  describe("Given the same batch is posted twice with the same Idempotency-Key", () => {
    it("Then the second call returns the cached response and the balance is applied once", async () => {
      const vendor = await createWallet("vendor-idem");
      const key = nextKey();
      const body = {
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 10000 },
          { wallet_id: vendor, type: "charge", amount_minor: 1000 },
        ],
      };

      const res1 = await post(body, key);
      expect(res1.status).toBe(201);
      const first = await res1.json();

      const res2 = await post(body, key);
      expect(res2.status).toBe(201);
      const second = await res2.json();

      expect(second).toEqual(first);
      expect(await getBalance(vendor)).toBe(9000);
    });
  });

  // ── Adjust operation in a batch ──────────────────────────────────────────

  describe("Given a settlement batch with a deposit and a negative adjustment", () => {
    it("Then it records an 'adjustment' movement and nets correctly", async () => {
      const vendor = await createWallet("vendor-adjust");

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
          { wallet_id: vendor, type: "adjust", amount_minor: -1500, reason: "manual correction" },
        ],
      });

      expect(res.status).toBe(201);
      const { operations } = await res.json();
      expect(await getBalance(vendor)).toBe(8500);

      const prisma = getTestPrisma();
      const movements = await prisma.movement.findMany({
        where: { id: { in: operations.map((o: { movement_id: string }) => o.movement_id) } },
      });
      expect(movements.map((m) => m.type).sort()).toEqual(["adjustment", "deposit"]);
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────

  describe("Input validation", () => {
    it("Given fewer than two operations, When posting, Then returns 400", async () => {
      const vendor = await createWallet("vendor-val-1");
      const res = await post({
        operations: [{ wallet_id: vendor, type: "deposit", amount_minor: 100 }],
      });
      expect(res.status).toBe(400);
    });

    it("Given a non-positive amount, When posting, Then returns 400", async () => {
      const vendor = await createWallet("vendor-val-2");
      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 0 },
          { wallet_id: vendor, type: "charge", amount_minor: 100 },
        ],
      });
      expect(res.status).toBe(400);
    });

    it("Given an unknown operation type, When posting, Then returns 400", async () => {
      const vendor = await createWallet("vendor-val-3");
      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 100 },
          { wallet_id: vendor, type: "explode", amount_minor: 100 },
        ],
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Authentication ───────────────────────────────────────────────────────

  describe("Given no API key", () => {
    it("Then posting a batch returns 401", async () => {
      const res = await app.unauthenticatedRequest(PATH, {
        method: "POST",
        headers: { "Idempotency-Key": nextKey() },
        body: JSON.stringify({
          operations: [
            { wallet_id: "w1", type: "deposit", amount_minor: 100 },
            { wallet_id: "w1", type: "charge", amount_minor: 50 },
          ],
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Cross-tenant isolation ───────────────────────────────────────────────

  describe("Given a wallet owned by the test platform", () => {
    it("Then the attacker platform cannot post a batch against it (404)", async () => {
      const victim = await createWallet("victim-wallet");
      await deposit(victim, 10000);

      const res = await post(
        {
          operations: [
            { wallet_id: victim, type: "deposit", amount_minor: 1000 },
            { wallet_id: victim, type: "charge", amount_minor: 500 },
          ],
        },
        nextKey(),
        app.attackerRequest,
      );

      expect(res.status).toBe(404);
      expect(await getBalance(victim)).toBe(10000);
    });
  });

  // ── Currency mismatch across operations ──────────────────────────────────

  describe("Given two wallets with different currencies", () => {
    it("Then posting a batch spanning both returns 422 CURRENCY_MISMATCH", async () => {
      const eur = await createWallet("vendor-eur", "EUR");
      const usd = await createWallet("vendor-usd", "USD");
      await deposit(eur, 10000);
      await deposit(usd, 10000);

      const res = await post({
        operations: [
          { wallet_id: eur, type: "charge", amount_minor: 1000 },
          { wallet_id: usd, type: "charge", amount_minor: 1000 },
        ],
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("CURRENCY_MISMATCH");
    });
  });

  // ── Non-existent wallet ──────────────────────────────────────────────────

  describe("Given an operation referencing a non-existent wallet", () => {
    it("Then posting returns 404", async () => {
      const vendor = await createWallet("vendor-missing-sibling");
      const fakeId = "019560a0-0000-7000-8000-000000000099";

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 1000 },
          { wallet_id: fakeId, type: "charge", amount_minor: 500 },
        ],
      });

      expect(res.status).toBe(404);
    });
  });

  // ── AUDIT: only `adjust` may drive the balance negative ──────────────────
  // The platform "negative" has allowNegativeBalance = true; "test" has false.
  // Invariant: deposit/withdraw/charge NEVER leave a wallet negative, regardless
  // of the platform flag — ONLY a negative `adjust` may, and only when allowed.

  describe("AUDIT — negative-balance policy", () => {
    describe("Given the platform forbids negative balances (test platform)", () => {
      it("Then a negative adjust that overdraws is rejected with 422 and nothing is applied", async () => {
        const vendor = await createWallet("audit-adj-forbidden");
        await deposit(vendor, 1000);

        const res = await post({
          operations: [
            { wallet_id: vendor, type: "deposit", amount_minor: 100, reason: "x" },
            { wallet_id: vendor, type: "adjust", amount_minor: -5000, reason: "penalty" },
          ],
        });

        expect(res.status).toBe(422);
        expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
        expect(await getBalance(vendor)).toBe(1000);
      });
    });

    describe("Given the platform allows negative balances", () => {
      const neg = () => app.negativeBalanceRequest;

      it("Then a negative adjust may drive the balance below zero", async () => {
        const vendor = await createWallet("audit-adj-allowed", "EUR", neg());
        await deposit(vendor, 1000, neg());

        const res = await post(
          {
            operations: [
              { wallet_id: vendor, type: "deposit", amount_minor: 100, reason: "x" },
              { wallet_id: vendor, type: "adjust", amount_minor: -5000, reason: "penalty" },
            ],
          },
          nextKey(),
          neg(),
        );

        expect(res.status).toBe(201);
        // 1000 + 100 - 5000 = -3900
        expect(await getBalance(vendor, neg())).toBe(-3900);
      });

      it("Then a CHARGE that overdraws is STILL rejected (only adjust honours the flag)", async () => {
        const vendor = await createWallet("audit-charge-allowed", "EUR", neg());
        await deposit(vendor, 1000, neg());

        const res = await post(
          {
            operations: [
              { wallet_id: vendor, type: "deposit", amount_minor: 100, reason: "sale" },
              { wallet_id: vendor, type: "charge", amount_minor: 5000, reason: "fee" },
            ],
          },
          nextKey(),
          neg(),
        );

        expect(res.status).toBe(422);
        expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
        expect(await getBalance(vendor, neg())).toBe(1000);
      });

      it("Then a WITHDRAW that overdraws is STILL rejected (only adjust honours the flag)", async () => {
        const vendor = await createWallet("audit-withdraw-allowed", "EUR", neg());
        await deposit(vendor, 1000, neg());

        const res = await post(
          {
            operations: [
              { wallet_id: vendor, type: "deposit", amount_minor: 100, reason: "sale" },
              { wallet_id: vendor, type: "withdraw", amount_minor: 5000, reason: "payout" },
            ],
          },
          nextKey(),
          neg(),
        );

        expect(res.status).toBe(422);
        expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
        expect(await getBalance(vendor, neg())).toBe(1000);
      });
    });
  });

  // ── Deterministic apply order (negative adjust applied last) ──────────────

  describe("Given a negative adjust listed before a charge that together fit (allowNegative platform)", () => {
    it("Then the charge applies first and only the adjust drives the balance negative", async () => {
      const neg = app.negativeBalanceRequest;
      const vendor = await createWallet("order-vendor", "EUR", neg);
      await deposit(vendor, 1000, neg);

      // Request lists adjust(-2000) first; naive order would starve the charge.
      const res = await post(
        {
          operations: [
            { wallet_id: vendor, type: "adjust", amount_minor: -2000, reason: "correction" },
            { wallet_id: vendor, type: "charge", amount_minor: 1000, reason: "fee" },
          ],
        },
        nextKey(),
        neg,
      );

      expect(res.status).toBe(201);
      // 1000 → charge -1000 → 0 → adjust -2000 → -2000
      expect(await getBalance(vendor, neg)).toBe(-2000);
    });
  });

  describe("Given preserve_operation_order = true with a debit listed before its funding credit", () => {
    it("Then the request order is respected and the debit fails with 422", async () => {
      const vendor = await createWallet("strict-order"); // balance 0

      const res = await post({
        operations: [
          { wallet_id: vendor, type: "charge", amount_minor: 1000, reason: "fee" },
          { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
        ],
        preserve_operation_order: true,
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
      expect(await getBalance(vendor)).toBe(0);
    });
  });

  // ── Extra edge cases ─────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("Given a batch mixing deposit, charge, withdraw and a positive adjust, Then the net is correct", async () => {
      const vendor = await createWallet("edge-mixed");
      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 10000, reason: "sale" },
          { wallet_id: vendor, type: "charge", amount_minor: 1500, reason: "commission" },
          { wallet_id: vendor, type: "withdraw", amount_minor: 2000, reason: "payout" },
          { wallet_id: vendor, type: "adjust", amount_minor: 250, reason: "goodwill" },
        ],
      });
      expect(res.status).toBe(201);
      // 10000 - 1500 - 2000 + 250 = 6750
      expect(await getBalance(vendor)).toBe(6750);
    });

    it("Given one-cent amounts, Then the batch applies exactly", async () => {
      const vendor = await createWallet("edge-cents");
      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 2 },
          { wallet_id: vendor, type: "charge", amount_minor: 1 },
        ],
      });
      expect(res.status).toBe(201);
      expect(await getBalance(vendor)).toBe(1);
    });

    it("Given the maximum of 50 operations on one wallet, Then it succeeds", async () => {
      const vendor = await createWallet("edge-max");
      const operations = [
        { wallet_id: vendor, type: "deposit", amount_minor: 50000, reason: "seed" },
        ...Array.from({ length: 49 }, () => ({
          wallet_id: vendor,
          type: "charge" as const,
          amount_minor: 100,
        })),
      ];
      const res = await post({ operations });
      expect(res.status).toBe(201);
      // 50000 - 49 * 100 = 45100
      expect(await getBalance(vendor)).toBe(45100);
    });

    it("Given more than 50 operations, Then it is rejected with 400", async () => {
      const vendor = await createWallet("edge-too-many");
      const operations = Array.from({ length: 51 }, () => ({
        wallet_id: vendor,
        type: "deposit" as const,
        amount_minor: 100,
      }));
      const res = await post({ operations });
      expect(res.status).toBe(400);
    });

    it("Given a non-integer amount, Then it is rejected with 400", async () => {
      const vendor = await createWallet("edge-float");
      const res = await post({
        operations: [
          { wallet_id: vendor, type: "deposit", amount_minor: 10.5 },
          { wallet_id: vendor, type: "charge", amount_minor: 1 },
        ],
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Multi-wallet batches ─────────────────────────────────────────────────

  describe("Multi-wallet batches", () => {
    it("Given two wallets of the same currency, Then a charge on A and a deposit on B apply atomically", async () => {
      const a = await createWallet("ml-a");
      const b = await createWallet("ml-b");
      await deposit(a, 10000);

      const res = await post({
        operations: [
          { wallet_id: a, type: "charge", amount_minor: 5000, reason: "rebalance out" },
          { wallet_id: b, type: "deposit", amount_minor: 5000, reason: "rebalance in" },
        ],
      });

      expect(res.status).toBe(201);
      expect(await getBalance(a)).toBe(5000);
      expect(await getBalance(b)).toBe(5000);

      // Each operation's movement is its own balanced (zero-sum) journal entry.
      const { operations } = await res.json();
      const prisma = getTestPrisma();
      for (const o of operations) {
        const entries = await prisma.ledgerEntry.findMany({ where: { movementId: o.movement_id } });
        expect(entries).toHaveLength(2);
        expect(entries.reduce((n, e) => n + e.amountMinor, 0n)).toBe(0n);
      }
    });

    it("Given one leg overdraws, Then the whole multi-wallet batch rolls back (no wallet is touched)", async () => {
      const a = await createWallet("ml-roll-a"); // balance 0
      const b = await createWallet("ml-roll-b"); // balance 0

      const res = await post({
        operations: [
          { wallet_id: b, type: "deposit", amount_minor: 5000 },
          { wallet_id: a, type: "charge", amount_minor: 1000 }, // A has no funds
        ],
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("INSUFFICIENT_FUNDS");
      expect(await getBalance(a)).toBe(0);
      // The deposit on B must have rolled back with the failed batch.
      expect(await getBalance(b)).toBe(0);
    });

    it("Given two batches touching the same two wallets in opposite order concurrently, Then there is no deadlock and balances converge", async () => {
      const a = await createWallet("dl-a");
      const b = await createWallet("dl-b");
      await deposit(a, 100000);
      await deposit(b, 100000);

      // Batch 1 locks A then B; Batch 2 locks B then A — the runner sorts the
      // keys so both acquire in the same order, so they serialize instead of
      // deadlocking. 409s (contention / version) are retried to convergence.
      const [r1, r2] = await Promise.all([
        postRetry({
          operations: [
            { wallet_id: a, type: "charge", amount_minor: 1000 },
            { wallet_id: b, type: "deposit", amount_minor: 1000 },
          ],
        }),
        postRetry({
          operations: [
            { wallet_id: b, type: "charge", amount_minor: 2000 },
            { wallet_id: a, type: "deposit", amount_minor: 2000 },
          ],
        }),
      ]);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      // A: 100000 - 1000 + 2000 = 101000 ; B: 100000 + 1000 - 2000 = 99000
      expect(await getBalance(a)).toBe(101000);
      expect(await getBalance(b)).toBe(99000);
    });
  });

  // ── Load: high-volume settlement burst ───────────────────────────────────
  // Mirrors the real settlement run: many DISTINCT vendors, one batch each
  // (sale credit + commission + holdback), all fired simultaneously. Each batch
  // locks only its own vendor wallet, so distinct vendors run in parallel and
  // the system shards are lock-free (atomic increment) — contention should stay
  // low and the success rate high.

  describe("Given 120 distinct vendors each receiving one settlement batch concurrently", () => {
    it("Then zero 500s escape, success rate is high, and each settled vendor nets correctly", async () => {
      const VENDORS = 120;
      const SALE = 10000;
      const COMMISSION = 1500;
      const HOLDBACK = 500;
      const NET = SALE - COMMISSION - HOLDBACK; // 8000

      const vendors: string[] = [];
      for (let i = 0; i < VENDORS; i++) {
        vendors.push(await createWallet(`burst-vendor-${i}`));
      }

      const results = await Promise.all(
        vendors.map((walletId, i) =>
          post(
            {
              operations: [
                { wallet_id: walletId, type: "deposit", amount_minor: SALE, reason: "sale" },
                { wallet_id: walletId, type: "charge", amount_minor: COMMISSION, reason: "commission" },
                { wallet_id: walletId, type: "charge", amount_minor: HOLDBACK, reason: "holdback" },
              ],
              reference: `settlement-${i}`,
            },
            `burst-${i}-${Date.now()}`,
          ),
        ),
      );

      const statuses = results.map((r) => r.status);
      // No server errors may escape; non-201s (if any) are retryable 409s.
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
      const ok = statuses.filter((s) => s === 201).length;
      expect(ok / VENDORS).toBeGreaterThan(0.95);

      // Every vendor that returned 201 must hold exactly the net amount.
      for (let i = 0; i < VENDORS; i++) {
        if (statuses[i] !== 201) continue;
        expect(await getBalance(vendors[i] as string)).toBe(NET);
      }
    });
  });

  // ── Load: concurrent batches on the SAME wallet (lock serialization) ──────
  // The distributed lock serializes batches that touch the same wallet, so
  // concurrent settlements on one vendor never race the balance below zero.

  describe("Given 6 concurrent batches charging the same funded wallet", () => {
    it("Then the balance never goes negative and reflects only the successful batches", async () => {
      const vendor = await createWallet("contended-vendor");
      await deposit(vendor, 10000);

      const BATCHES = 6;
      const CHARGE = 1500; // 6 × (1000 + 500) charges = 9000 ≤ 10000, all should fit

      const results = await Promise.all(
        Array.from({ length: BATCHES }, (_, i) =>
          post(
            {
              operations: [
                { wallet_id: vendor, type: "charge", amount_minor: 1000, reason: "fee-a" },
                { wallet_id: vendor, type: "charge", amount_minor: 500, reason: "fee-b" },
              ],
            },
            `contended-${i}-${Date.now()}`,
          ),
        ),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
      const ok = statuses.filter((s) => s === 201).length;

      // Balance must equal initial minus the charges that actually committed,
      // and never below zero.
      const balance = await getBalance(vendor);
      expect(balance).toBe(10000 - ok * CHARGE);
      expect(balance).toBeGreaterThanOrEqual(0);
    });
  });
});
