import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

const DAY = 86_400_000;

interface Bucket {
  bucket: string | null;
  sum_net_minor: number | string;
  sum_credits_minor: number | string;
  sum_debits_minor: number | string;
  min_minor: number | string;
  max_minor: number | string;
  count: number;
}

describe("Movement Breakdown E2E (per-wallet + platform)", () => {
  let app: TestApp;
  let idempCounter = 0;

  const nextKey = (p = "mb") => `${p}-${++idempCounter}-${Date.now()}`;

  async function createWallet(ownerId: string, currency = "USD"): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("create") },
      body: JSON.stringify({ owner_id: ownerId, currency_code: currency }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).wallet_id;
  }

  async function deposit(
    walletId: string,
    amountMinor: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("deposit") },
      body: JSON.stringify({ amount_minor: amountMinor, ...(metadata ? { metadata } : {}) }),
    });
    expect(res.status).toBe(201);
  }

  async function charge(walletId: string, amountMinor: number): Promise<void> {
    const res = await app.request(`/v1/wallets/${walletId}/charge`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey("charge") },
      body: JSON.stringify({ amount_minor: amountMinor }),
    });
    expect(res.status).toBe(201);
  }

  const byBucket = (rows: Bucket[], name: string) => rows.find((r) => r.bucket === name);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    idempCounter = 0;
  });

  // ── per-wallet ──────────────────────────────────────────────────────────────

  describe("Given a wallet with a deposit and a charge", () => {
    it("Then group_by=type reports signed sums from the wallet's own ledger (system side excluded)", async () => {
      const walletId = await createWallet("mb-user");
      await deposit(walletId, 10000);
      await charge(walletId, 3000);

      const now = Date.now();
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      // If the system (omnibus) counterpart leaked in, net would be 0. It is not.
      expect(byBucket(rows, "deposit")).toMatchObject({
        sum_net_minor: 10000,
        sum_credits_minor: 10000,
        sum_debits_minor: 0,
        count: 1,
      });
      expect(byBucket(rows, "charge")).toMatchObject({
        sum_net_minor: -3000,
        sum_credits_minor: 0,
        sum_debits_minor: -3000,
        count: 1,
      });
    });

    it("Then group_by=metadata groups by the consumer's metadata key", async () => {
      const walletId = await createWallet("mb-meta-user");
      await deposit(walletId, 4200, { reasonKey: "settlement" });

      const now = Date.now();
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=metadata&metadata_key=reasonKey`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      expect(byBucket(rows, "settlement")).toMatchObject({ sum_net_minor: 4200, count: 1 });
    });

    it("Then direction=credit restricts the breakdown to credits", async () => {
      const walletId = await createWallet("mb-dir-user");
      await deposit(walletId, 10000);
      await charge(walletId, 3000);

      const now = Date.now();
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type&direction=credit`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      expect(byBucket(rows, "deposit")).toMatchObject({ sum_net_minor: 10000 });
      expect(byBucket(rows, "charge")).toBeUndefined();
    });

    it("Then min_minor/max_minor report the smallest and largest signed entries per bucket", async () => {
      const walletId = await createWallet("mb-minmax-user");
      await deposit(walletId, 4000);
      await deposit(walletId, 10000);
      await charge(walletId, 3000);

      const now = Date.now();
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      // Deposits: signed +4000 and +10000 → min 4000, max 10000.
      expect(byBucket(rows, "deposit")).toMatchObject({ min_minor: 4000, max_minor: 10000, count: 2 });
      // The single charge is a debit (-3000), so min === max === -3000.
      expect(byBucket(rows, "charge")).toMatchObject({ min_minor: -3000, max_minor: -3000 });
    });

    it("Then a metadata_filter_key+value narrows the aggregation to matching rows before grouping", async () => {
      const walletId = await createWallet("mb-filter-user");
      await deposit(walletId, 10000, { reasonKey: "_MovementReasonSettlementSales" });
      await deposit(walletId, 4200, { reasonKey: "_MovementReasonPurchase" });

      const now = Date.now();
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type&metadata_filter_key=reasonKey&metadata_filter_value=_MovementReasonSettlementSales`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      // Only the settlement deposit is counted; the purchase deposit is excluded.
      expect(byBucket(rows, "deposit")).toMatchObject({ sum_net_minor: 10000, count: 1 });
    });

    it("Then a metadata_filter_key without a value returns 400", async () => {
      const walletId = await createWallet("mb-filter-bad");
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=1&to=2&group_by=type&metadata_filter_key=reasonKey`,
      );
      expect(res.status).toBe(400);
    });

    it("Then an invalid range (to < from) returns 400", async () => {
      const walletId = await createWallet("mb-badrange");
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=2000&to=1000&group_by=type`,
      );
      expect(res.status).toBe(400);
    });

    it("Then group_by=metadata without metadata_key returns 400", async () => {
      const walletId = await createWallet("mb-nokey");
      const res = await app.request(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=1&to=2&group_by=metadata`,
      );
      expect(res.status).toBe(400);
    });

    it("Then an unauthenticated client returns 401", async () => {
      const walletId = await createWallet("mb-auth");
      const res = await app.unauthenticatedRequest(
        `/v1/wallets/${walletId}/analytics/movement-breakdown?from=1&to=2&group_by=type`,
      );
      expect(res.status).toBe(401);
    });

    it("Then a non-existent wallet returns 404", async () => {
      const fakeId = "019560a0-0000-7000-8000-0000000000dd";
      const res = await app.request(
        `/v1/wallets/${fakeId}/analytics/movement-breakdown?from=1&to=2&group_by=type`,
      );
      expect(res.status).toBe(404);
    });

    it("Then an attacker platform cannot read the victim's wallet breakdown (404)", async () => {
      const victimWalletId = await createWallet("mb-victim");
      await deposit(victimWalletId, 5000);

      const now = Date.now();
      const res = await app.attackerRequest(
        `/v1/wallets/${victimWalletId}/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type`,
      );
      expect(res.status).toBe(404);
    });
  });

  // ── platform-wide ─────────────────────────────────────────────────────────

  describe("Given two wallets with deposits on the platform", () => {
    it("Then group_by=owner ranks each owner's net (system side excluded)", async () => {
      const a = await createWallet("mb-owner-a");
      const b = await createWallet("mb-owner-b");
      await deposit(a, 10000);
      await deposit(b, 4000);

      const now = Date.now();
      const res = await app.request(
        `/v1/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=owner`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      expect(byBucket(rows, "mb-owner-a")).toMatchObject({ sum_net_minor: 10000 });
      expect(byBucket(rows, "mb-owner-b")).toMatchObject({ sum_net_minor: 4000 });
    });

    it("Then group_by=type aggregates across all wallets", async () => {
      await deposit(await createWallet("mb-agg-a"), 10000);
      await deposit(await createWallet("mb-agg-b"), 4000);

      const now = Date.now();
      const res = await app.request(
        `/v1/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      expect(byBucket(rows, "deposit")).toMatchObject({ sum_net_minor: 14000, count: 2 });
    });

    it("Then owner_id narrows the platform breakdown to a single owner", async () => {
      const a = await createWallet("mb-narrow-a");
      await deposit(a, 10000);
      await deposit(await createWallet("mb-narrow-b"), 4000);

      const now = Date.now();
      const res = await app.request(
        `/v1/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type&owner_id=mb-narrow-a`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      expect(byBucket(rows, "deposit")).toMatchObject({ sum_net_minor: 10000, count: 1 });
    });

    it("Then a metadata_filter_key+value narrows the platform breakdown across wallets", async () => {
      const a = await createWallet("mb-pf-a");
      const b = await createWallet("mb-pf-b");
      await deposit(a, 10000, { reasonKey: "_MovementReasonSettlementSales" });
      await deposit(b, 7000, { reasonKey: "_MovementReasonSettlementSales" });
      await deposit(a, 4200, { reasonKey: "_MovementReasonPurchase" });

      const now = Date.now();
      const res = await app.request(
        `/v1/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type&metadata_filter_key=reasonKey&metadata_filter_value=_MovementReasonSettlementSales`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      // Both settlement deposits across the two wallets, the purchase excluded.
      expect(byBucket(rows, "deposit")).toMatchObject({ sum_net_minor: 17000, count: 2 });
    });

    it("Then an unknown group_by returns 400", async () => {
      const res = await app.request("/v1/analytics/movement-breakdown?from=1&to=2&group_by=nope");
      expect(res.status).toBe(400);
    });

    it("Then group_by=metadata without metadata_key returns 400", async () => {
      const res = await app.request("/v1/analytics/movement-breakdown?from=1&to=2&group_by=metadata");
      expect(res.status).toBe(400);
    });

    it("Then an unauthenticated client returns 401", async () => {
      const res = await app.unauthenticatedRequest(
        "/v1/analytics/movement-breakdown?from=1&to=2&group_by=type",
      );
      expect(res.status).toBe(401);
    });

    it("Then a platform only ever sees its own movements (cross-tenant isolation)", async () => {
      const victim = await createWallet("mb-iso-victim");
      await deposit(victim, 99999);

      const now = Date.now();
      const res = await app.attackerRequest(
        `/v1/analytics/movement-breakdown?from=${now - DAY}&to=${now + DAY}&group_by=type`,
      );
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Bucket[];

      // The attacker platform has no wallets, so it can never see the victim's flow.
      expect(byBucket(rows, "deposit")).toBeUndefined();
    });
  });
});
