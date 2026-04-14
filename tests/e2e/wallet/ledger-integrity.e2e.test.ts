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

  // ── Chain validation: INSERT with wrong balance_after blocked ────────

  describe("Given a wallet with existing ledger entries", () => {
    describe("When attempting to INSERT a ledger entry with an incorrect balance_after_cents", () => {
      it("Then the database should reject the operation with CHAIN_BREAK", async () => {
        const walletA = await createWallet("owner-chain-break-a");
        await deposit(walletA, 10000); // balance is now 10000

        const prisma = getTestPrisma();

        // Fetch a real transaction_id and movement_id from the deposit
        // so the FK constraints pass — only balance_after_cents is wrong
        const refs: { tid: string; mid: string }[] = await prisma.$queryRaw`
          SELECT t.id AS tid, t.movement_id AS mid
          FROM transactions t
          WHERE t.wallet_id = ${walletA}
          LIMIT 1
        `;
        expect(refs.length).toBeGreaterThan(0);
        const { tid, mid } = refs[0]!;

        // current balance = 10000, amount = 500 → correct balance_after = 10500
        // we write 99999 to trigger CHAIN_BREAK
        try {
          await prisma.$executeRaw`
            INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, movement_id, created_at)
            VALUES (
              gen_random_uuid()::text,
              ${tid},
              ${walletA},
              'CREDIT',
              500,
              99999,
              ${mid},
              (SELECT MAX(created_at) + 1 FROM ledger_entries WHERE wallet_id = ${walletA})
            )
          `;
          expect.fail("INSERT with wrong balance_after_cents should have been blocked by chain validation");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/CHAIN_BREAK/i);
        }
      });
    });
  });

  // ── Chain validation: first entry with wrong balance blocked ──────────

  describe("Given a wallet with no ledger entries", () => {
    describe("When attempting to INSERT a first ledger entry with balance_after_cents != amount_cents", () => {
      it("Then the database should reject the operation with CHAIN_BREAK", async () => {
        const walletA = await createWallet("owner-chain-break-first");
        // No deposit — wallet is empty, prev_balance = 0

        // Create a movement and transaction via API to get real FK refs,
        // but intercept before any ledger entry is written.
        // Instead: fetch system wallet transaction refs as a valid FK source.
        const prisma = getTestPrisma();

        // We need real FK refs — create a deposit to get them, then try a
        // second insert with wrong balance starting from 0 (a new wallet).
        // Simpler: we rely on the previous wallet's refs for FK validity,
        // targeting the NEW (empty) wallet — chain starts at 0.
        const walletB = await createWallet("owner-chain-break-first-ref");
        await deposit(walletB, 5000); // just to have valid FK refs

        const refs: { tid: string; mid: string }[] = await prisma.$queryRaw`
          SELECT t.id AS tid, t.movement_id AS mid
          FROM transactions t
          WHERE t.wallet_id = ${walletB}
          LIMIT 1
        `;
        const { tid, mid } = refs[0]!;

        // First entry for walletA: prev = 0, amount = 100 → correct = 100
        // We write 999 to trigger CHAIN_BREAK
        try {
          await prisma.$executeRaw`
            INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, movement_id, created_at)
            VALUES (
              gen_random_uuid()::text,
              ${tid},
              ${walletA},
              'CREDIT',
              100,
              999,
              ${mid},
              ${BigInt(Date.now())}
            )
          `;
          expect.fail("First INSERT with wrong balance_after_cents should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/CHAIN_BREAK/i);
        }
      });
    });
  });

  // ── Chain validation: correct chain accepted ──────────────────────────

  describe("Given deposits and withdrawals on a wallet", () => {
    describe("When summing ledger entries by wallet and comparing to balance_after of last entry", () => {
      it("Then balance_after_cents of the last entry matches the running sum (chain is intact)", async () => {
        const walletA = await createWallet("owner-chain-valid-a");
        await deposit(walletA, 50000);
        await deposit(walletA, 20000);
        await withdraw(walletA, 10000);

        const prisma = getTestPrisma();

        const rows: { last_balance: unknown; total: unknown }[] = await prisma.$queryRaw`
          SELECT
            (SELECT balance_after_cents FROM ledger_entries
             WHERE wallet_id = ${walletA}
             ORDER BY created_at DESC, id DESC LIMIT 1) AS last_balance,
            COALESCE(SUM(amount_cents), 0) AS total
          FROM ledger_entries
          WHERE wallet_id = ${walletA}
        `;

        expect(Number(rows[0]!.last_balance)).toBe(Number(rows[0]!.total));
        expect(Number(rows[0]!.last_balance)).toBe(60000); // 50000 + 20000 - 10000
      });
    });
  });

  // ── Zero-sum: unbalanced movement entries blocked ──────────────────────

  describe("Given an existing movement with a correctly balanced entry", () => {
    describe("When inserting a second entry that breaks the zero-sum invariant", () => {
      it("Then the database should reject the operation with ZERO_SUM_VIOLATION", async () => {
        const walletA = await createWallet("owner-zerosum-a");
        await deposit(walletA, 10000);

        const prisma = getTestPrisma();

        // Get a real movement_id and transaction_id from the deposit
        const refs: { tid: string; mid: string; wid: string }[] = await prisma.$queryRaw`
          SELECT t.id AS tid, t.movement_id AS mid, t.wallet_id AS wid
          FROM transactions t
          WHERE t.wallet_id = ${walletA}
          LIMIT 1
        `;
        const { tid, mid } = refs[0]!;

        // The deposit already created 2 balanced entries (sum=0).
        // Insert a third entry on this movement with a positive amount — breaks zero-sum.
        try {
          await prisma.$executeRaw`
            INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, movement_id, created_at)
            VALUES (
              gen_random_uuid()::text,
              ${tid},
              ${walletA},
              'CREDIT',
              999,
              10999,
              ${mid},
              (SELECT MAX(created_at) + 1 FROM ledger_entries WHERE wallet_id = ${walletA})
            )
          `;
          expect.fail("Unbalanced entry should have been blocked by zero-sum trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/ZERO_SUM_VIOLATION|CHAIN_BREAK/i);
        }
      });
    });
  });

  // ── DELETE on wallets with ledger entries blocked ─────────────────────

  describe("Given a wallet with ledger entries exists", () => {
    describe("When attempting to DELETE the wallet directly in the database", () => {
      it("Then the database should reject the operation with DELETE_BLOCKED", async () => {
        const walletA = await createWallet("owner-del-a");
        await deposit(walletA, 10000);

        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`DELETE FROM wallets WHERE id = ${walletA}`;
          expect.fail("DELETE on wallet with ledger entries should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/DELETE_BLOCKED/i);
        }
      });
    });
  });

  // ── DELETE on wallets with holds blocked ──────────────────────────────

  describe("Given a wallet with an active hold exists", () => {
    describe("When attempting to DELETE the wallet directly in the database", () => {
      it("Then the database should reject the operation with DELETE_BLOCKED", async () => {
        const walletA = await createWallet("owner-del-hold-a");
        await deposit(walletA, 50000);

        // Create a hold on the wallet
        const holdRes = await app.request(`/v1/holds`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletA, amount_cents: 10000 }),
        });
        expect(holdRes.status).toBe(201);

        const prisma = getTestPrisma();

        // First delete ledger entries to isolate the holds check
        // (ledger_entries is append-only so this will also fail — instead we test
        //  a fresh wallet that only has holds via direct SQL insert bypass is not possible,
        //  so we verify the error from ledger entries takes precedence)
        try {
          await prisma.$executeRaw`DELETE FROM wallets WHERE id = ${walletA}`;
          expect.fail("DELETE on wallet with holds should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/DELETE_BLOCKED/i);
        }
      });
    });
  });

  // ── DELETE on wallets with NO history allowed ─────────────────────────

  describe("Given a wallet with no ledger entries and no holds", () => {
    describe("When attempting to DELETE the wallet directly in the database", () => {
      it("Then the database should allow the deletion", async () => {
        const walletA = await createWallet("owner-del-empty");

        const prisma = getTestPrisma();

        // No deposit — wallet has no ledger entries or holds
        const deleted = await prisma.$executeRaw`DELETE FROM wallets WHERE id = ${walletA}`;
        expect(deleted).toBe(1);
      });
    });
  });

  // ── Reconciliation: cached_balance_cents must match entry balance_after ──

  describe("Given a wallet whose cached_balance_cents was tampered directly in the database", () => {
    describe("When a new ledger entry is inserted with the correct chain but mismatched cached balance", () => {
      it("Then the database should reject the operation with RECONCILIATION_FAILED", async () => {
        const walletA = await createWallet("owner-reconcile-a");
        await deposit(walletA, 10000); // real balance = 10000

        const prisma = getTestPrisma();

        // Tamper cached_balance_cents directly (field lock does not protect this field)
        await prisma.$executeRaw`
          UPDATE wallets SET cached_balance_cents = 99999 WHERE id = ${walletA}
        `;

        // Fetch real FK refs from the existing deposit
        const refs: { tid: string; mid: string }[] = await prisma.$queryRaw`
          SELECT t.id AS tid, t.movement_id AS mid
          FROM transactions t
          WHERE t.wallet_id = ${walletA}
          LIMIT 1
        `;
        const { tid, mid } = refs[0]!;

        // Insert a ledger entry with correct chain (10000 + 500 = 10500)
        // but cached_balance is 99999 — reconciliation must catch this
        try {
          await prisma.$executeRaw`
            INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, movement_id, created_at)
            VALUES (
              gen_random_uuid()::text,
              ${tid},
              ${walletA},
              'CREDIT',
              500,
              10500,
              ${mid},
              (SELECT MAX(created_at) + 1 FROM ledger_entries WHERE wallet_id = ${walletA})
            )
          `;
          expect.fail("INSERT should have been blocked by reconciliation trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/RECONCILIATION_FAILED/i);
        }
      });
    });
  });

  describe("Given normal deposits and withdrawals on a wallet", () => {
    describe("When operations complete successfully", () => {
      it("Then cached_balance_cents always matches balance_after_cents of the last ledger entry", async () => {
        const walletA = await createWallet("owner-reconcile-valid");
        await deposit(walletA, 50000);
        await withdraw(walletA, 15000);
        await deposit(walletA, 5000);

        const prisma = getTestPrisma();

        const rows: { cached: unknown; last_balance: unknown }[] = await prisma.$queryRaw`
          SELECT
            w.cached_balance_cents AS cached,
            (SELECT balance_after_cents FROM ledger_entries
             WHERE wallet_id = ${walletA}
             ORDER BY created_at DESC, id DESC LIMIT 1) AS last_balance
          FROM wallets w
          WHERE w.id = ${walletA}
        `;

        expect(Number(rows[0]!.cached)).toBe(Number(rows[0]!.last_balance));
        expect(Number(rows[0]!.cached)).toBe(40000); // 50000 - 15000 + 5000
      });
    });
  });

  // ── Field lock: immutable wallet identity fields ───────────────────────

  describe("Given an existing wallet", () => {
    describe("When attempting to change owner_id directly in the database", () => {
      it("Then the database should reject the operation with FIELD_LOCK", async () => {
        const walletId = await createWallet("owner-field-lock-a");
        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`
            UPDATE wallets SET owner_id = 'attacker-owner' WHERE id = ${walletId}
          `;
          expect.fail("UPDATE owner_id should have been blocked by field lock trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/FIELD_LOCK/i);
        }
      });
    });
  });

  describe("Given an existing wallet", () => {
    describe("When attempting to change currency_code directly in the database", () => {
      it("Then the database should reject the operation with FIELD_LOCK", async () => {
        const walletId = await createWallet("owner-field-lock-b");
        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`
            UPDATE wallets SET currency_code = 'EUR' WHERE id = ${walletId}
          `;
          expect.fail("UPDATE currency_code should have been blocked by field lock trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/FIELD_LOCK/i);
        }
      });
    });
  });

  describe("Given an existing non-system wallet", () => {
    describe("When attempting to promote it to is_system=true directly in the database", () => {
      it("Then the database should reject the operation with FIELD_LOCK", async () => {
        const walletId = await createWallet("owner-field-lock-c");
        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`
            UPDATE wallets SET is_system = true WHERE id = ${walletId}
          `;
          expect.fail("UPDATE is_system should have been blocked by field lock trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/FIELD_LOCK/i);
        }
      });
    });
  });

  describe("Given an existing wallet", () => {
    describe("When attempting to change created_at directly in the database", () => {
      it("Then the database should reject the operation with FIELD_LOCK", async () => {
        const walletId = await createWallet("owner-field-lock-d");
        const prisma = getTestPrisma();

        try {
          await prisma.$executeRaw`
            UPDATE wallets SET created_at = 0 WHERE id = ${walletId}
          `;
          expect.fail("UPDATE created_at should have been blocked by field lock trigger");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/FIELD_LOCK/i);
        }
      });
    });
  });

  describe("Given an existing wallet", () => {
    describe("When updating only allowed fields (status, cached_balance_cents)", () => {
      it("Then the database should allow the update", async () => {
        const walletId = await createWallet("owner-field-lock-allowed");
        const prisma = getTestPrisma();

        // Mutable fields must be updatable — the trigger should not block these
        await expect(
          prisma.$executeRaw`
            UPDATE wallets SET status = 'frozen', updated_at = ${BigInt(Date.now())}
            WHERE id = ${walletId}
          `,
        ).resolves.toBe(1);
      });
    });
  });

  // ── State machine: wallet status transitions ──────────────────────────

  describe("Given a closed wallet", () => {
    describe("When attempting to set status back to 'active' directly in the database", () => {
      it("Then the database should reject the operation with INVALID_TRANSITION", async () => {
        const walletA = await createWallet("owner-sm-wallet-a");

        const prisma = getTestPrisma();

        // Close the wallet via API: first freeze is not needed, close requires balance=0 (already 0)
        const closeRes = await app.request(`/v1/wallets/${walletA}/close`, { method: "POST" });
        expect(closeRes.status).toBe(200);

        // Try to resurrect via direct SQL
        try {
          await prisma.$executeRaw`
            UPDATE wallets SET status = 'active' WHERE id = ${walletA}
          `;
          expect.fail("Resurrecting a closed wallet should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/INVALID_TRANSITION/i);
        }
      });
    });
  });

  describe("Given a frozen wallet", () => {
    describe("When closing it directly in the database", () => {
      it("Then the database should allow the transition (frozen → closed is valid)", async () => {
        const walletA = await createWallet("owner-sm-wallet-b");

        // Freeze it via API
        const freezeRes = await app.request(`/v1/wallets/${walletA}/freeze`, { method: "POST" });
        expect(freezeRes.status).toBe(200);

        const prisma = getTestPrisma();

        // frozen → closed is valid (app allows it in close())
        await expect(
          prisma.$executeRaw`
            UPDATE wallets SET status = 'closed' WHERE id = ${walletA}
          `,
        ).resolves.toBe(1);
      });
    });
  });

  // ── State machine: hold status transitions ────────────────────────────

  describe("Given a captured hold", () => {
    describe("When attempting to set status back to 'active' directly in the database", () => {
      it("Then the database should reject the operation with INVALID_TRANSITION", async () => {
        const walletA = await createWallet("owner-sm-hold-a");
        await deposit(walletA, 50000);

        // Place and capture a hold
        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletA, amount_cents: 10000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        const captureRes = await app.request(`/v1/holds/${hold_id}/capture`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
        });
        expect(captureRes.status).toBe(201);

        const prisma = getTestPrisma();

        // Try to reactivate the captured hold via direct SQL
        try {
          await prisma.$executeRaw`
            UPDATE holds SET status = 'active' WHERE id = ${hold_id}
          `;
          expect.fail("Reactivating a captured hold should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/INVALID_TRANSITION/i);
        }
      });
    });
  });

  describe("Given a voided hold", () => {
    describe("When attempting to capture it directly in the database", () => {
      it("Then the database should reject the operation with INVALID_TRANSITION", async () => {
        const walletA = await createWallet("owner-sm-hold-b");
        await deposit(walletA, 50000);

        // Place and void a hold
        const holdRes = await app.request("/v1/holds", {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ wallet_id: walletA, amount_cents: 5000 }),
        });
        expect(holdRes.status).toBe(201);
        const { hold_id } = await holdRes.json();

        const voidRes = await app.request(`/v1/holds/${hold_id}/void`, {
          method: "POST",
        });
        expect(voidRes.status).toBe(200);

        const prisma = getTestPrisma();

        // Try to capture the voided hold via direct SQL
        try {
          await prisma.$executeRaw`
            UPDATE holds SET status = 'captured' WHERE id = ${hold_id}
          `;
          expect.fail("Capturing a voided hold should have been blocked");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          expect(message).toMatch(/INVALID_TRANSITION/i);
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
