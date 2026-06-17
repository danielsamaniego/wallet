import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

/**
 * Adversarial / edge-case coverage for the cutover read API:
 *   - GET /v1/wallets/:id/statement                  (R2 + R5 free-text q)
 *   - GET /v1/wallets/:id/statement/:movementId      (R3)
 *   - GET /v1/wallets/:id/analytics/cash-flow         (R4)
 *   - GET /v1/wallets/:id/analytics/balance-timeseries (R4)
 *
 * These go beyond the happy-path suites (statement.e2e, analytics.e2e):
 * running-balance integrity across mixed ops, transfers (both legs + shared
 * movement id), hold capture, search safety (LIKE wildcards / injection),
 * pagination & listing-contract boundaries, range inclusivity, carry-in /
 * carry-forward, and the 366-day cap boundary.
 */
describe("Statement & Analytics — edge cases E2E", () => {
  let app: TestApp;
  let idemp = 0;
  const DAY = 86_400_000;
  const key = (p = "edge") => `${p}-${++idemp}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": key("create") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function op(
    walletId: string,
    action: "deposit" | "withdraw" | "charge",
    amountMinor: number,
    reference?: string,
  ): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/${action}`, {
      method: "POST",
      headers: { "Idempotency-Key": key(action) },
      body: JSON.stringify({ amount_minor: amountMinor, reference }),
    });
    expect(res.status).toBe(201);
  }

  async function adjust(
    walletId: string,
    amountMinor: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/adjust`, {
      method: "POST",
      headers: { "Idempotency-Key": key("adjust") },
      body: JSON.stringify({ amount_minor: amountMinor, reason, metadata }),
    });
    expect(res.status).toBe(201);
  }

  async function transfer(
    source: string,
    target: string,
    amountMinor: number,
    reference?: string,
  ): Promise<void> {
    const res = await app.request("/v1/transfers", {
      method: "POST",
      headers: { "Idempotency-Key": key("transfer") },
      body: JSON.stringify({
        source_wallet_id: source,
        target_wallet_id: target,
        amount_minor: amountMinor,
        reference,
      }),
    });
    expect(res.status).toBe(201);
  }

  async function placeHold(walletId: string, amountMinor: number): Promise<string> {
    const res = await app.request("/v1/holds", {
      method: "POST",
      headers: { "Idempotency-Key": key("hold") },
      body: JSON.stringify({ wallet_id: walletId, amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).hold_id;
  }

  async function captureHold(holdId: string): Promise<void> {
    const res = await app.request(`/v1/holds/${holdId}/capture`, {
      method: "POST",
      headers: { "Idempotency-Key": key("capture") },
    });
    expect(res.status).toBe(201);
  }

  async function balance(walletId: string): Promise<number> {
    const res = await app.request(`/v1/wallets/${walletId}`);
    expect(res.status).toBe(200);
    return (await res.json()).balance_minor;
  }

  async function statement(walletId: string, query = ""): Promise<Response> {
    return app.request(`/v1/wallets/${walletId}/statement${query}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idemp = 0;
  });

  // ── A. Running-balance integrity across mixed operations ───────────────────

  describe("Given a wallet with deposit, charge, deposit, withdraw", () => {
    it("Then every statement line is sign-coherent and balances reconcile with the wallet and cash-flow", async () => {
      const w = await createWallet("edge-chain");
      await op(w, "deposit", 10000);
      await op(w, "charge", 3000);
      await op(w, "deposit", 5000);
      await op(w, "withdraw", 2000);

      // Cached wallet balance is the source of truth.
      expect(await balance(w)).toBe(10000); // 10000 - 3000 + 5000 - 2000

      const body = await (await statement(w, "?limit=100")).json();
      expect(body.entries).toHaveLength(4);

      // Each line: balance_after - balance_before === signed(amount by direction).
      for (const e of body.entries) {
        const signed = e.direction === "credit" ? e.amount_minor : -e.amount_minor;
        expect(e.balance_after_minor - e.balance_before_minor).toBe(signed);
      }

      // The running balances are exactly the prefix sums (order-independent).
      const afters = body.entries.map((e: { balance_after_minor: number }) => e.balance_after_minor);
      expect([...afters].sort((a, b) => a - b)).toEqual([7000, 10000, 10000, 12000]);

      // Cash-flow over an enclosing range must reconcile to the same net.
      const now = Date.now();
      const cf = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${now - DAY}&to=${now + DAY}`)
      ).json();
      expect(cf.income_minor).toBe(15000);
      expect(cf.expense_minor).toBe(5000);
      expect(cf.net_minor).toBe(10000);
    });
  });

  describe("Given a negative adjustment", () => {
    it("Then it surfaces as adjustment_debit with a positive amount and a debit direction", async () => {
      const w = await createWallet("edge-adj");
      await op(w, "deposit", 5000);
      await adjust(w, -2000, "Penalty");

      const body = await (await statement(w)).json();
      const adj = body.entries.find((e: { type: string }) => e.type === "adjustment_debit");
      expect(adj).toBeDefined();
      expect(adj.amount_minor).toBe(2000); // magnitude, not the signed input
      expect(adj.direction).toBe("debit");
      expect(adj.reason).toBe("Penalty");
      expect(adj.balance_before_minor).toBe(5000);
      expect(adj.balance_after_minor).toBe(3000);
    });
  });

  // ── B. Transfers: both legs, counterpart, shared movement id ───────────────

  describe("Given a transfer from A to B", () => {
    it("Then A shows transfer_out (debit→B) and B shows transfer_in (credit←A), sharing one movement id", async () => {
      const a = await createWallet("edge-A");
      const b = await createWallet("edge-B");
      await op(a, "deposit", 10000);
      await transfer(a, b, 4000, "INV-777");

      const aBody = await (await statement(a)).json();
      const bBody = await (await statement(b)).json();

      const out = aBody.entries.find((e: { type: string }) => e.type === "transfer_out");
      const inc = bBody.entries.find((e: { type: string }) => e.type === "transfer_in");
      expect(out).toBeDefined();
      expect(inc).toBeDefined();

      expect(out.direction).toBe("debit");
      expect(out.amount_minor).toBe(4000);
      expect(out.counterpart_wallet_id).toBe(b);
      expect(out.balance_after_minor).toBe(6000);
      expect(out.reference).toBe("INV-777");

      expect(inc.direction).toBe("credit");
      expect(inc.amount_minor).toBe(4000);
      expect(inc.counterpart_wallet_id).toBe(a);
      expect(inc.balance_after_minor).toBe(4000);

      // One movement, two legs.
      expect(out.movement_id).toBe(inc.movement_id);
    });

    it("Then GET /statement/:movementId returns each wallet's own side of the shared movement", async () => {
      const a = await createWallet("edge-A2");
      const b = await createWallet("edge-B2");
      await op(a, "deposit", 10000);
      await transfer(a, b, 4000);

      const out = (await (await statement(a)).json()).entries.find(
        (e: { type: string }) => e.type === "transfer_out",
      );
      const movementId = out.movement_id;

      const aSide = await app.request(`/v1/wallets/${a}/statement/${movementId}`);
      const bSide = await app.request(`/v1/wallets/${b}/statement/${movementId}`);
      expect(aSide.status).toBe(200);
      expect(bSide.status).toBe(200);

      const aJson = await aSide.json();
      const bJson = await bSide.json();
      expect(aJson.movement_id).toBe(movementId);
      expect(bJson.movement_id).toBe(movementId);
      expect(aJson.direction).toBe("debit");
      expect(bJson.direction).toBe("credit");
      expect(aJson.counterpart_wallet_id).toBe(b);
      expect(bJson.counterpart_wallet_id).toBe(a);
    });

    it("Then cash-flow counts transfer_out as expense for A and transfer_in as income for B", async () => {
      const a = await createWallet("edge-A3");
      const b = await createWallet("edge-B3");
      await op(a, "deposit", 10000);
      await transfer(a, b, 4000);

      const now = Date.now();
      const range = `from=${now - DAY}&to=${now + DAY}`;
      const cfA = await (await app.request(`/v1/wallets/${a}/analytics/cash-flow?${range}`)).json();
      const cfB = await (await app.request(`/v1/wallets/${b}/analytics/cash-flow?${range}`)).json();

      expect(cfA.expense_minor).toBe(4000);
      expect(cfA.income_minor).toBe(10000); // the deposit
      expect(cfB.income_minor).toBe(4000);
      expect(cfB.expense_minor).toBe(0);
    });
  });

  // ── C. Holds: only captured holds touch the statement / cash-flow ──────────

  describe("Given a wallet with a deposit and an uncaptured hold", () => {
    it("Then the hold does not appear in the statement nor in cash-flow expense", async () => {
      const w = await createWallet("edge-hold");
      await op(w, "deposit", 10000);
      await placeHold(w, 3000);

      const body = await (await statement(w)).json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].type).toBe("deposit");

      const now = Date.now();
      const cf = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${now - DAY}&to=${now + DAY}`)
      ).json();
      expect(cf.expense_minor).toBe(0);
    });
  });

  describe("Given a captured hold", () => {
    it("Then a hold_capture debit appears in the statement with hold_id and counts as expense", async () => {
      const w = await createWallet("edge-capture");
      await op(w, "deposit", 10000);
      const holdId = await placeHold(w, 3000);
      await captureHold(holdId);

      const body = await (await statement(w)).json();
      const cap = body.entries.find((e: { type: string }) => e.type === "hold_capture");
      expect(cap).toBeDefined();
      expect(cap.direction).toBe("debit");
      expect(cap.amount_minor).toBe(3000);
      expect(cap.hold_id).toBe(holdId);

      const now = Date.now();
      const cf = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${now - DAY}&to=${now + DAY}`)
      ).json();
      expect(cf.expense_minor).toBe(3000);
    });
  });

  // ── D. Free-text search (q) safety & semantics ─────────────────────────────

  describe("Given movements whose reason carries searchable text", () => {
    it("Then q matches the reason case-insensitively", async () => {
      const w = await createWallet("edge-q-reason");
      await op(w, "deposit", 5000);
      await adjust(w, 1000, "Refund ALPHA order");

      const body = await (await statement(w, "?q=alpha")).json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].reason).toBe("Refund ALPHA order");
    });
  });

  describe("Given references that could collide with SQL LIKE wildcards", () => {
    it("Then q is treated literally — '_' and '%' do not act as wildcards", async () => {
      const w = await createWallet("edge-q-wild");
      await op(w, "deposit", 10000);
      await op(w, "charge", 100, "ABC");
      await op(w, "charge", 100, "AXC");

      // '_' as a LIKE wildcard would match both ABC and AXC; literal matches neither.
      const underscore = await (await statement(w, "?q=A_C")).json();
      expect(underscore.entries).toHaveLength(0);

      // '%' as a LIKE wildcard would match everything; literal matches nothing here.
      const percent = await (await statement(w, "?q=%25")).json(); // %25 = '%'
      expect(percent.entries).toHaveLength(0);
    });

    it("Then a SQL-injection-looking q returns 200 with no matches and no error", async () => {
      const w = await createWallet("edge-q-inj");
      await op(w, "deposit", 5000, "SAFEREF");

      const res = await statement(w, `?q=${encodeURIComponent("'; DROP TABLE transactions;--")}`);
      expect(res.status).toBe(200);
      expect((await res.json()).entries).toHaveLength(0);

      // The table is intact: the prior data still reads back.
      const after = await (await statement(w)).json();
      expect(after.entries).toHaveLength(1);
    });

    it("Then an oversized q (> 256 chars) is rejected with 400", async () => {
      const w = await createWallet("edge-q-long");
      await op(w, "deposit", 5000, "SAFEREF");

      const res = await statement(w, `?q=${"x".repeat(257)}`);
      expect(res.status).toBe(400);
    });
  });

  describe("Given q combined with a type filter", () => {
    it("Then only rows matching BOTH the text and the type are returned", async () => {
      const w = await createWallet("edge-q-filter");
      await op(w, "deposit", 10000, "FEEALPHA"); // matches q but wrong type
      await op(w, "charge", 1000, "FEEALPHA"); // matches both
      await op(w, "charge", 1000, "OTHER"); // right type, wrong text

      const body = await (await statement(w, "?q=fee&filter%5Btype%5D=charge")).json();
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].type).toBe("charge");
      expect(body.entries[0].reference).toBe("FEEALPHA");
    });
  });

  // ── E. Pagination & listing-contract boundaries ────────────────────────────

  describe("Given 5 movements and a page size of 2", () => {
    it("Then walking the cursor returns all 5 with no gaps or duplicates", async () => {
      const w = await createWallet("edge-page");
      for (let i = 0; i < 5; i++) await op(w, "deposit", 1000 + i);

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const q: string = cursor
          ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
          : "?limit=2";
        const body = await (await statement(w, q)).json();
        for (const e of body.entries) seen.add(e.movement_id);
        cursor = body.next_cursor;
        pages++;
        expect(pages).toBeLessThanOrEqual(4); // guard against infinite loop
      } while (cursor);

      expect(seen.size).toBe(5);
      expect(pages).toBe(3); // 2 + 2 + 1
    });
  });

  describe("Given out-of-contract limit values", () => {
    it.each([
      ["limit=0", "?limit=0"],
      ["limit=101", "?limit=101"],
      ["limit=-1", "?limit=-1"],
      ["limit=1.5", "?limit=1.5"],
      ["limit=abc", "?limit=abc"],
    ])("Then %s is rejected with 400", async (_label, q) => {
      const w = await createWallet("edge-limit");
      const res = await statement(w, q);
      expect(res.status).toBe(400);
    });

    it("Then limit=100 (the max) is accepted", async () => {
      const w = await createWallet("edge-limit-max");
      await op(w, "deposit", 1000);
      const res = await statement(w, "?limit=100");
      expect(res.status).toBe(200);
    });
  });

  describe("Given malformed listing parameters", () => {
    it("Then an unknown filter parameter is rejected with 400", async () => {
      const w = await createWallet("edge-badfilter");
      const res = await statement(w, "?filter%5Bbogus%5D=x");
      expect(res.status).toBe(400);
    });

    it("Then sorting by a non-sortable field is rejected with 400", async () => {
      const w = await createWallet("edge-badsort");
      const res = await statement(w, "?sort=balance_after");
      expect(res.status).toBe(400);
    });

    it("Then a cursor minted for a different sort signature is rejected with 400", async () => {
      const w = await createWallet("edge-cursor-sig");
      for (let i = 0; i < 3; i++) await op(w, "deposit", 1000 + i);

      const first = await (await statement(w, "?limit=2")).json(); // default sort
      expect(first.next_cursor).toBeTruthy();

      const mismatched = await statement(
        w,
        `?limit=2&sort=-amount_minor&cursor=${encodeURIComponent(first.next_cursor)}`,
      );
      expect(mismatched.status).toBe(400);
    });

    it("Then sorting by amount_minor desc orders the statement by amount", async () => {
      const w = await createWallet("edge-sort-amt");
      await op(w, "deposit", 1000);
      await op(w, "deposit", 9000);
      await op(w, "deposit", 5000);

      const body = await (await statement(w, "?sort=-amount_minor&limit=100")).json();
      const amounts = body.entries.map((e: { amount_minor: number }) => e.amount_minor);
      expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
      expect(amounts[0]).toBe(9000);
    });
  });

  // ── F. Reads on non-active wallets & format edges ──────────────────────────

  describe("Given a frozen wallet", () => {
    it("Then its statement and analytics remain readable (reads are not blocked)", async () => {
      const w = await createWallet("edge-frozen");
      await op(w, "deposit", 5000);
      const fr = await app.request(`/v1/wallets/${w}/freeze`, {
        method: "POST",
        headers: { "Idempotency-Key": key("freeze") },
      });
      expect(fr.status).toBe(200);

      expect((await statement(w)).status).toBe(200);
      const now = Date.now();
      const cf = await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${now - DAY}&to=${now}`);
      expect(cf.status).toBe(200);
    });
  });

  describe("Given a movement that belongs to a different wallet of the same platform", () => {
    it("Then fetching it under the wrong wallet returns 404", async () => {
      const a = await createWallet("edge-iso-A");
      const b = await createWallet("edge-iso-B");
      await op(a, "deposit", 5000);
      const movementId = (await (await statement(a)).json()).entries[0].movement_id;

      const res = await app.request(`/v1/wallets/${b}/statement/${movementId}`);
      expect(res.status).toBe(404);
    });

    it("Then a non-UUID movement id returns 404 (not 500)", async () => {
      const w = await createWallet("edge-badmv");
      const res = await app.request(`/v1/wallets/${w}/statement/not-a-uuid`);
      expect(res.status).toBe(404);
    });
  });

  // ── G. Cash-flow boundary inclusivity & parameter edges ────────────────────

  describe("Given a single deposit at a known instant", () => {
    it("Then cash-flow includes it only when the range covers that instant (gte/lte)", async () => {
      const w = await createWallet("edge-cf-bound");
      await op(w, "deposit", 7000);
      const t = (await (await statement(w)).json()).entries[0].created_at;

      const at = await (await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${t}&to=${t}`)).json();
      expect(at.income_minor).toBe(7000); // inclusive both ends

      const after = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${t + 1}&to=${t + 1000}`)
      ).json();
      expect(after.income_minor).toBe(0);

      const before = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${t - 1000}&to=${t - 1}`)
      ).json();
      expect(before.income_minor).toBe(0);
    });
  });

  describe("Given a range with no movements", () => {
    it("Then cash-flow reports zero income, expense and net", async () => {
      const w = await createWallet("edge-cf-empty");
      await op(w, "deposit", 5000);
      const now = Date.now();
      const cf = await (
        await app.request(`/v1/wallets/${w}/analytics/cash-flow?from=${now - 4 * DAY}&to=${now - 3 * DAY}`)
      ).json();
      expect(cf.income_minor).toBe(0);
      expect(cf.expense_minor).toBe(0);
      expect(cf.net_minor).toBe(0);
    });
  });

  describe("Given invalid cash-flow parameters", () => {
    it.each([
      ["negative from", "?from=-1&to=10"],
      ["float from", "?from=1.5&to=10"],
      ["non-numeric from", "?from=abc&to=10"],
      ["missing from", "?to=10"],
      ["missing to", "?from=10"],
    ])("Then %s is rejected with 400", async (_label, q) => {
      const w = await createWallet("edge-cf-bad");
      const res = await app.request(`/v1/wallets/${w}/analytics/cash-flow${q}`);
      expect(res.status).toBe(400);
    });

    it("Then a non-existent wallet returns 404", async () => {
      const fake = "019560a0-0000-7000-8000-0000000000ee";
      const res = await app.request(`/v1/wallets/${fake}/analytics/cash-flow?from=1&to=2`);
      expect(res.status).toBe(404);
    });
  });

  // ── H. Balance-timeseries: carry-in, carry-forward, end-of-day, cap ────────

  describe("Given a deposit before the queried range", () => {
    it("Then carry-in seeds the first day and the balance carries forward across empty days", async () => {
      const w = await createWallet("edge-ts-carry");
      await op(w, "deposit", 8000);
      const now = Date.now();

      const res = await app.request(
        `/v1/wallets/${w}/analytics/balance-timeseries?from=${now + 2 * DAY}&to=${now + 4 * DAY}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.points.length).toBeGreaterThanOrEqual(3);
      for (const p of body.points) expect(p.balance_minor).toBe(8000);
    });
  });

  describe("Given two movements on the same day", () => {
    it("Then that day's point is the end-of-day balance (last movement wins)", async () => {
      const w = await createWallet("edge-ts-eod");
      await op(w, "deposit", 5000);
      await op(w, "charge", 1000);
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);

      const body = await (
        await app.request(`/v1/wallets/${w}/analytics/balance-timeseries?from=${now - DAY}&to=${now}`)
      ).json();
      const todays = body.points.find((p: { date: string }) => p.date === today);
      expect(todays.balance_minor).toBe(4000);
    });
  });

  describe("Given a range entirely before any movement", () => {
    it("Then every point is zero", async () => {
      const w = await createWallet("edge-ts-before");
      await op(w, "deposit", 5000);
      const now = Date.now();
      const body = await (
        await app.request(
          `/v1/wallets/${w}/analytics/balance-timeseries?from=${now - 4 * DAY}&to=${now - 3 * DAY}`,
        )
      ).json();
      expect(body.points.every((p: { balance_minor: number }) => p.balance_minor === 0)).toBe(true);
    });
  });

  describe("Given the 366-day cap boundary", () => {
    it("Then exactly 366 days is accepted and 367 days is rejected", async () => {
      const w = await createWallet("edge-ts-cap");
      const ok = await app.request(
        `/v1/wallets/${w}/analytics/balance-timeseries?from=0&to=${365 * DAY}`,
      );
      expect(ok.status).toBe(200); // 366 inclusive days

      const tooBig = await app.request(
        `/v1/wallets/${w}/analytics/balance-timeseries?from=0&to=${366 * DAY}`,
      );
      expect(tooBig.status).toBe(400);
      expect((await tooBig.json()).error).toBe("RANGE_TOO_LARGE");
    });
  });

  describe("Given the victim platform's wallet", () => {
    it("Then the attacker cannot read its timeseries and an unauthenticated client gets 401", async () => {
      const w = await createWallet("edge-ts-tenant");
      await op(w, "deposit", 5000);
      const now = Date.now();
      const q = `from=${now - DAY}&to=${now}`;

      expect((await app.attackerRequest(`/v1/wallets/${w}/analytics/balance-timeseries?${q}`)).status).toBe(404);
      expect((await app.unauthenticatedRequest(`/v1/wallets/${w}/analytics/balance-timeseries?${q}`)).status).toBe(401);
    });
  });
});
