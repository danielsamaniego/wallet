# E2E Test Patterns

> How to write end-to-end tests against the real Hono app with Docker PostgreSQL.

---

## Overview

E2E tests exercise the full stack: HTTP request -> Hono middleware -> handler -> use case -> Prisma -> PostgreSQL. They run sequentially (`fileParallelism: false`) against a real Docker PostgreSQL instance.

**Config:** `vitest.e2e.config.ts`

```ts
{
  include: ["test/e2e/**/*.e2e.test.ts"],
  globalSetup: ["test/e2e/setup/global-setup.ts"],
  testTimeout: 30_000,
  hookTimeout: 30_000,
  pool: "forks",
  fileParallelism: false,
}
```

---

## Copy-Paste Template: E2E Test

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("POST /v1/wallets/:id/deposit", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.teardown();
  });

  beforeEach(async () => {
    await app.truncateAll();
    await app.seedTestPlatform();
  });

  // ── Helper: authenticated request ─────────────────────────────
  const post = (path: string, body: Record<string, unknown>) =>
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Platform-Id": app.platformId,
          "X-Api-Key": app.apiKey,
        },
        body: JSON.stringify(body),
      }),
    );

  const get = (path: string) =>
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "GET",
        headers: {
          "X-Platform-Id": app.platformId,
          "X-Api-Key": app.apiKey,
        },
      }),
    );

  // ── 1. Happy path ──────────────────────────────────────────────
  describe("Given a valid active wallet", () => {
    let walletId: string;

    beforeEach(async () => {
      // Create wallet via API
      const res = await post("/v1/wallets", {
        ownerId: "owner-1",
        currencyCode: "USD",
      });
      const data = await res.json();
      walletId = data.id;
    });

    describe("When depositing 5000 cents", () => {
      it("Then returns 200 with transactionId", async () => {
        const res = await post(`/v1/wallets/${walletId}/deposit`, {
          amountCents: 5000,
          idempotencyKey: "idem-1",
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.transactionId).toBeDefined();
        expect(data.movementId).toBeDefined();
      });

      it("Then wallet balance increases", async () => {
        await post(`/v1/wallets/${walletId}/deposit`, {
          amountCents: 5000,
          idempotencyKey: "idem-2",
        });

        const res = await get(`/v1/wallets/${walletId}`);
        const wallet = await res.json();
        expect(wallet.cachedBalanceCents).toBe(5000);
      });
    });
  });

  // ── 2. Authentication attacks ──────────────────────────────────
  describe("Security: Authentication attacks", () => {
    it("Then rejects request without API key", async () => {
      const res = await app.fetch(
        new Request("http://localhost/v1/wallets/w-1/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents: 1000, idempotencyKey: "k" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("Then rejects request with invalid API key", async () => {
      const res = await app.fetch(
        new Request("http://localhost/v1/wallets/w-1/deposit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Platform-Id": app.platformId,
            "X-Api-Key": "invalid-key",
          },
          body: JSON.stringify({ amountCents: 1000, idempotencyKey: "k" }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  // ── 3. Input validation attacks ────────────────────────────────
  describe("Security: Input validation attacks", () => {
    it("Then rejects zero amount", async () => {
      const res = await post(`/v1/wallets/w-1/deposit`, {
        amountCents: 0,
        idempotencyKey: "k",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("Then rejects negative amount", async () => {
      const res = await post(`/v1/wallets/w-1/deposit`, {
        amountCents: -1000,
        idempotencyKey: "k",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("Then rejects non-numeric amount", async () => {
      const res = await post(`/v1/wallets/w-1/deposit`, {
        amountCents: "abc",
        idempotencyKey: "k",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ... continue with remaining security categories ...
});
```

---

## RULE: The 11 Security Audit Categories

Every new endpoint MUST have tests for ALL applicable categories:

### 1. Authentication Attacks
- Missing API key header
- Invalid API key
- Missing platform ID header
- Mismatched platform ID and API key

### 2. Input Validation Attacks
- Zero amounts
- Negative amounts
- Non-numeric amounts
- String injection in ID fields
- Extremely large amounts (overflow attempts)
- Missing required fields
- Extra unexpected fields (should be ignored, not crash)

### 3. Cross-Tenant Isolation
- Platform A cannot access Platform B's wallets
- Platform A cannot deposit into Platform B's wallet
- Platform A cannot see Platform B's transactions
- System wallets are not directly accessible via API

### 4. Balance Manipulation
- Deposit then verify exact balance change
- Multiple deposits accumulate correctly
- Withdraw then verify exact balance change
- Cannot withdraw more than available balance (including holds)

### 5. Idempotency Attacks
- Same idempotency key returns same result (no duplicate processing)
- Different idempotency key processes a new request
- Idempotency key from a different operation type is rejected or treated independently

### 6. Concurrency / Race Conditions
- Two concurrent deposits on the same wallet (optimistic locking / retry)
- Two concurrent withdrawals that would overdraft
- Concurrent deposit + withdrawal
- Concurrent transfer in + transfer out

### 7. Hold Exploitation
- Place hold then capture exact amount
- Place hold then try to capture more than hold amount
- Place hold, withdraw remaining, then try to capture (insufficient after withdrawal)
- Place hold, void it, then try to capture voided hold
- Place hold, let it expire, then try to capture expired hold

### 8. Wallet Lifecycle
- Deposit into frozen wallet (rejected)
- Withdraw from frozen wallet (rejected)
- Transfer from frozen wallet (rejected)
- Operations on closed wallet (all rejected)
- Close wallet with non-zero balance (rejected)
- Close wallet with active holds (rejected)

### 9. Ledger Integrity Verification
- After deposit: sum of ledger entries for the wallet matches final balance
- After transfer: sum of debits equals sum of credits (zero-sum)
- Ledger entries are immutable (no UPDATE/DELETE via API)
- Transaction references are correct (walletId, counterpartWalletId)

### 10. Edge Cases & Boundary Values
- Deposit of 1 cent (minimum)
- Transfer of 1 cent
- Wallet with maximum BigInt balance (if applicable)
- Very long reference strings
- Unicode in reference/metadata fields
- Rapid sequential operations on the same wallet

### 11. Information Disclosure
- Error responses do not leak internal IDs or stack traces
- 404 for non-existent wallet does not reveal whether the wallet exists on another platform
- System wallet details are not exposed to API consumers

---

## How to Use `createTestApp()`

The test app factory starts the Hono app with real dependencies (Prisma + PostgreSQL):

```ts
const app = await createTestApp();

// app.fetch()      -- sends a Request to the Hono app
// app.platformId   -- the seeded test platform ID
// app.apiKey       -- the seeded test API key
// app.prisma       -- direct Prisma client for assertions
// app.teardown()   -- cleanup (disconnect Prisma, etc.)
```

---

## Cleanup Between Tests

Every `beforeEach` must clean the database to ensure test isolation:

```ts
beforeEach(async () => {
  await app.truncateAll();       // DELETE FROM all tables (cascading)
  await app.seedTestPlatform();  // Re-insert the test platform + API key
});
```

This ensures:
- No leftover wallets, transactions, or holds from previous tests.
- The test platform exists for authenticated requests.
- Tests are completely independent and can run in any order.

---

## Verifying DB State Directly

Use the Prisma client to assert database state after API operations:

```ts
it("Then the wallet record exists in the database", async () => {
  const res = await post("/v1/wallets", {
    ownerId: "owner-1",
    currencyCode: "USD",
  });
  const data = await res.json();

  // Direct DB assertion
  const dbWallet = await app.prisma.wallet.findUnique({
    where: { id: data.id },
  });
  expect(dbWallet).not.toBeNull();
  expect(dbWallet!.ownerId).toBe("owner-1");
  expect(dbWallet!.currencyCode).toBe("USD");
  expect(dbWallet!.status).toBe("active");
});

it("Then ledger entries sum to the correct balance", async () => {
  // ... perform deposits/withdrawals ...

  const entries = await app.prisma.ledgerEntry.findMany({
    where: { walletId },
  });
  const sum = entries.reduce((acc, e) => acc + e.amountCents, 0n);
  expect(sum).toBe(expectedBalance);
});
```

---

## Sequential Execution

E2E tests run with `fileParallelism: false` and `pool: "forks"`. This means:

- Test files execute one at a time (no parallel file execution).
- Within a file, tests execute sequentially (default Vitest behavior).
- This prevents database conflicts between test files.
- Each file can safely truncate and re-seed without interfering with other files.

---

## Checklist Before Submitting an E2E Test

- [ ] All 11 security audit categories are addressed (where applicable).
- [ ] `beforeEach` does `truncateAll()` + `seedTestPlatform()`.
- [ ] `afterAll` calls `app.teardown()`.
- [ ] Authenticated requests include `X-Platform-Id` and `X-Api-Key` headers.
- [ ] Database state is verified directly via Prisma for critical assertions.
- [ ] Error responses are checked for correct HTTP status codes.
- [ ] No hardcoded wallet/transaction IDs (create them via API in the test setup).
- [ ] File is named `*.e2e.test.ts` to match the e2e config include pattern.
