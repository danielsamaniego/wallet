import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";
import { getTestPrisma } from "@test/helpers/db.js";

describe("Ledger Integrity E2E", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = () => `ledger-integrity-${++idempCounter}`;

  /** Helper: create a wallet and return its ID. */
  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
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

  /** Helper: withdraw from a wallet. */
  async function withdraw(walletId: string, amountCents: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_cents: amountCents }),
    });
    expect(res.status).toBe(201);
  }

  /** Helper: transfer between wallets. */
  async function transfer(sourceId: string, targetId: string, amountCents: number): Promise<void> {
    const res = await app.request("/v1/transfers", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({
        source_wallet_id: sourceId,
        target_wallet_id: targetId,
        amount_cents: amountCents,
      }),
    });
    expect(res.status).toBe(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
  });

  // ── All movements are zero-sum ──────────────────────────────────────────

  describe("Given several deposits, withdrawals, and transfers have been executed", () => {
    describe("When summing ledger entries grouped by movement_id", () => {
      it("Then every movement sums to exactly zero (double-entry)", async () => {
        const walletA = await createWallet("owner-a");
        const walletB = await createWallet("owner-b");

        await deposit(walletA, 50000);
        await deposit(walletB, 30000);
        await withdraw(walletA, 10000);
        await transfer(walletA, walletB, 5000);

        const prisma = getTestPrisma();
        const results: { movement_id: string; total: unknown }[] = await prisma.$queryRaw`
          SELECT movement_id, SUM(amount_cents) AS total
          FROM ledger_entries
          GROUP BY movement_id
        `;

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
          // Prisma $queryRaw returns Decimal for SUM of BigInt columns
          expect(Number(row.total)).toBe(0);
        }
      });
    });
  });

  // ── Cached balance matches ledger sum ──────────────────────────────────

  describe("Given several operations on a wallet", () => {
    describe("When comparing the cached balance to the sum of all ledger entries", () => {
      it("Then they should match for every wallet", async () => {
        const walletA = await createWallet("owner-ledger-a");
        const walletB = await createWallet("owner-ledger-b");

        await deposit(walletA, 100000);
        await deposit(walletB, 50000);
        await withdraw(walletA, 20000);
        await transfer(walletA, walletB, 15000);

        const prisma = getTestPrisma();

        // Get cached balances for non-system wallets
        const wallets: { id: string; cached_balance_cents: unknown }[] = await prisma.$queryRaw`
          SELECT id, cached_balance_cents FROM wallets WHERE is_system = false
        `;

        for (const wallet of wallets) {
          const [ledgerSum]: [{ total: unknown }] = await prisma.$queryRaw`
            SELECT COALESCE(SUM(amount_cents), 0) AS total
            FROM ledger_entries
            WHERE wallet_id = ${wallet.id}
          `;

          // Prisma $queryRaw returns Decimal/BigInt — compare as numbers
          expect(Number(wallet.cached_balance_cents)).toBe(Number(ledgerSum.total));
        }
      });
    });
  });

  // ── No negative non-system balances ──────────────────────────────────────

  describe("Given all operations have been completed", () => {
    describe("When querying non-system wallet balances", () => {
      it("Then no non-system wallet should have a negative cached balance", async () => {
        const walletA = await createWallet("owner-neg-a");
        const walletB = await createWallet("owner-neg-b");

        await deposit(walletA, 50000);
        await deposit(walletB, 30000);
        await transfer(walletA, walletB, 10000);

        const prisma = getTestPrisma();
        const negativeWallets: { id: string; cached_balance_cents: bigint }[] = await prisma.$queryRaw`
          SELECT id, cached_balance_cents FROM wallets
          WHERE is_system = false AND cached_balance_cents < 0
        `;

        expect(negativeWallets).toHaveLength(0);
      });
    });
  });

  // ── All transaction amounts positive ──────────────────────────────────────

  describe("Given multiple financial operations have been recorded", () => {
    describe("When querying all transaction amounts", () => {
      it("Then every transaction amount_cents should be positive", async () => {
        const walletA = await createWallet("owner-pos-a");
        const walletB = await createWallet("owner-pos-b");

        await deposit(walletA, 25000);
        await deposit(walletB, 15000);
        await withdraw(walletA, 5000);
        await transfer(walletA, walletB, 3000);

        const prisma = getTestPrisma();
        const nonPositive: { id: string; amount_cents: bigint }[] = await prisma.$queryRaw`
          SELECT id, amount_cents FROM transactions WHERE amount_cents <= 0
        `;

        expect(nonPositive).toHaveLength(0);
      });
    });
  });

  // ── UPDATE on ledger_entries blocked (immutable trigger) ─────────────────

  describe("Given an existing ledger entry", () => {
    describe("When attempting to UPDATE a ledger entry directly in the database", () => {
      it("Then the database should reject the operation with an error", async () => {
        const walletA = await createWallet("owner-immut-a");
        await deposit(walletA, 10000);

        const prisma = getTestPrisma();

        // Find any ledger entry to attempt mutation
        const entries: { id: string }[] = await prisma.$queryRaw`
          SELECT id FROM ledger_entries LIMIT 1
        `;
        expect(entries.length).toBeGreaterThan(0);

        try {
          await prisma.$executeRaw`
            UPDATE ledger_entries SET amount_cents = 999999 WHERE id = ${entries[0]!.id}
          `;
          // If we reach here, the trigger did not fire
          expect.fail("UPDATE on ledger_entries should have been blocked by immutable trigger");
        } catch (error: unknown) {
          // The trigger raises an exception containing "append-only"
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/append-only|immutable|not allowed/i);
        }
      });
    });
  });

  // ── DELETE on ledger_entries blocked ──────────────────────────────────────

  describe("Given an existing ledger entry", () => {
    describe("When attempting to DELETE a ledger entry directly in the database", () => {
      it("Then the database should reject the operation with an error", async () => {
        const walletA = await createWallet("owner-immut-b");
        await deposit(walletA, 10000);

        const prisma = getTestPrisma();

        const entries: { id: string }[] = await prisma.$queryRaw`
          SELECT id FROM ledger_entries LIMIT 1
        `;
        expect(entries.length).toBeGreaterThan(0);

        try {
          await prisma.$executeRaw`
            DELETE FROM ledger_entries WHERE id = ${entries[0]!.id}
          `;
          expect.fail("DELETE on ledger_entries should have been blocked by immutable trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/append-only|immutable|not allowed/i);
        }
      });
    });
  });

  // ── DB constraint blocks negative balance via direct SQL ──────────────

  describe("Given a non-system wallet exists in the database", () => {
    describe("When attempting to set cached_balance_cents to -1 via direct SQL", () => {
      it("Then the database should reject the operation with a constraint violation", async () => {
        const walletA = await createWallet("owner-neg-constraint");
        await deposit(walletA, 10000);

        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`
            UPDATE wallets SET cached_balance_cents = -1
            WHERE id = ${walletA} AND is_system = false
          `;
          expect.fail("UPDATE setting negative balance should have been blocked by a DB constraint");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/violates|constraint|check/i);
        }
      });
    });
  });
});
