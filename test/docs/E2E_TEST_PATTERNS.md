# E2E Test Patterns

> How to write robust end-to-end tests against the Dockerized Wallet Service.
> **E2E tests are the last line of defense. They must be thorough, paranoid, and cover every attack vector.**
> **Every HTTP endpoint in the service MUST have e2e coverage. There are no exceptions for "simple" endpoints.**

---

## Overview

E2E tests exercise the **full stack in Docker**: HTTP request → Hono middleware → handler → use case → Prisma → PostgreSQL. Both PostgreSQL and the App run in isolated Docker containers — completely separate from the dev environment.

**Config:** `vitest.e2e.config.ts`

```ts
{
  include: ["tests/e2e/**/*.e2e.test.ts"],
  globalSetup: ["tests/e2e/setup/global-setup.ts"],
  testTimeout: 30_000,
  hookTimeout: 30_000,
  pool: "forks",
  fileParallelism: false,  // sequential — tests share DB
}
```

---

## Docker Infrastructure (Isolated from Dev)

| | Dev | Test |
|---|---|---|
| **Compose file** | `docker-compose.yml` | `docker-compose.test.yml` |
| **Project name** | `wallet` | `wallet-test` |
| **PostgreSQL port** | `:5432` / DB `wallet` | `:5433` / DB `wallet_test` |
| **App port** | `:3000` | `:3333` |
| **Volume** | `wallet_postgres_data` | `wallet-test_postgres_test_data` |

**`pnpm test:e2e` is fully self-contained:**
1. Starts PostgreSQL container → waits healthy
2. Runs `prisma db push` + applies `immutable_ledger.sql` constraints
3. Seeds test platforms (2: test + attacker)
4. Builds and starts App container → waits healthy
5. Runs all e2e tests via `fetch("http://localhost:3333/...")`
6. Truncates all tables → stops containers

Dev containers are NEVER touched.

---

## Copy-Paste Template

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createTestApp, type TestApp } from "../setup/test-app.js";

describe("Feature Name E2E", () => {
  let app: TestApp;
  let idempCounter = 0;
  const nextKey = () => `feature-${++idempCounter}`;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();  // TRUNCATE all + re-seed platforms
    idempCounter = 0;
  });

  /** Helper: create wallet and return ID */
  async function createWallet(ownerId: string): Promise<string> {
    const res = await app.request("/v1/wallets", {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ owner_id: ownerId, currency_code: "USD" }),
    });
    return (await res.json()).wallet_id;
  }

  /** Helper: deposit */
  async function deposit(walletId: string, cents: number): Promise<void> {
    await app.request(`/v1/wallets/${walletId}/deposit`, {
      method: "POST",
      headers: { "Idempotency-Key": nextKey() },
      body: JSON.stringify({ amount_cents: cents }),
    });
  }

  describe("Given an active wallet with 10000 cents", () => {
    let walletId: string;

    beforeEach(async () => {
      walletId = await createWallet("owner-1");
      await deposit(walletId, 10000);
    });

    describe("When withdrawing 5000 cents", () => {
      it("Then returns 201 with transaction ID", async () => {
        const res = await app.request(`/v1/wallets/${walletId}/withdraw`, {
          method: "POST",
          headers: { "Idempotency-Key": nextKey() },
          body: JSON.stringify({ amount_cents: 5000 }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.transaction_id).toBeDefined();
      });
    });
  });
});
```

---

## `createTestApp()` API

```ts
const app = await createTestApp();

app.baseUrl                    // "http://localhost:3333"
app.prisma                     // Prisma client for direct DB assertions
app.request(path, init?)       // Authenticated request (test platform API key)
app.attackerRequest(path, init?) // Authenticated as attacker platform
app.unauthenticatedRequest(path, init?) // No API key header
app.reset()                    // TRUNCATE all tables + re-seed both platforms
```

**Important:** Always use `Idempotency-Key` header on mutation requests (POST). Use unique keys per test — a counter or `Date.now()` suffix works well.

---

## THE 12 SECURITY CATEGORIES (MANDATORY)

Every HTTP endpoint MUST have e2e tests for ALL applicable categories below. New endpoints require new e2e coverage, and changes to existing endpoints require updating their e2e tests in the same work. This is not optional — it's how we ensure the system is robust against real-world attacks.

### 1. Authentication Attacks
Test that unauthenticated and badly-authenticated requests are rejected:
- Missing API key → 401
- Malformed key (no dot separator) → 401
- Valid key ID + wrong secret → 401
- Empty API key → 401
- SQL injection in API key → 401
- Oversized API key → 401/413

### 2. Input Validation Attacks
Test that malformed input is rejected without crashing:
- Negative amounts → 400/422
- Zero amounts → 400/422
- Float amounts (100.5) → 400/422
- String amounts ("1000") → 400/422
- Massive amounts (BigInt overflow) → 400/422 or handled safely
- Invalid currency codes (4 chars, numbers) → 400/422
- Missing required fields → 400/422
- Empty body / malformed JSON → 400/422
- SQL injection in path parameters → 404/400
- XSS payloads in string fields → accepted safely or rejected
- Prototype pollution (`__proto__`, `constructor.prototype`) → ignored safely
- Oversized string fields → 400/422
- Negative zero (-0) → 400/422

### 3. Cross-Tenant Isolation
Test that one platform CANNOT access another platform's resources:
- Attacker reads victim wallet → 404 (not 403, to prevent enumeration)
- Attacker deposits/withdraws from victim → 404
- Attacker transfers victim→attacker → 404
- Attacker places hold on victim wallet → 404
- Attacker captures/voids victim's hold → 404
- Attacker freezes/closes victim wallet → 404

### 4. Balance Manipulation
Test that financial invariants hold:
- Overdraft withdrawal (more than balance) → 422 INSUFFICIENT_FUNDS
- Overdraft transfer → 422 INSUFFICIENT_FUNDS
- Self-transfer (source = target) → 400 SAME_WALLET
- Operations on frozen wallet → 422 WALLET_NOT_ACTIVE
- Operations on closed wallet → 422

### 5. Idempotency
Test that idempotency keys work correctly and can't be exploited:
- Same key returns cached response (identical status + body)
- Same key + different body → 422 IDEMPOTENCY_PAYLOAD_MISMATCH
- Missing Idempotency-Key on mutations → 400
- Same key on different endpoints → 422 (hash includes method:path)
- Same key across platforms → both succeed (scoped per platform)

### 6. Concurrency & Race Conditions
Test that the system handles concurrent requests safely:
- **N concurrent deposits**: final balance = sum of successful deposits (some may get 409 VERSION_CONFLICT)
- **N concurrent withdrawals**: balance NEVER goes negative (some fail with 422/409)
- **Bidirectional transfers A↔B**: zero 500 errors (no deadlocks thanks to ID-sorted locking)
- **Concurrent hold placement**: no over-reservation (available balance respected)

**Implementation:** Use `Promise.all()` with unique idempotency keys. Assert on aggregate outcomes (final balance, error counts) not individual results — concurrency is non-deterministic.

### 7. Hold Exploitation
Test that holds can't be exploited:
- Hold prevents withdrawal of held amount
- Double capture → 422 (hold already captured)
- Capture after void → 422 (hold not active)
- Hold with past expiry → 400/422
- Oversized hold (> available balance) → 422 INSUFFICIENT_FUNDS
- Concurrent holds → no over-reservation
- Cross-tenant hold capture/void → 404

### 8. Wallet Lifecycle
Test state machine transitions:
- Close wallet with balance → 422 WALLET_BALANCE_NOT_ZERO
- Freeze system wallet → 422 CANNOT_FREEZE_SYSTEM_WALLET
- Close system wallet → 422 CANNOT_CLOSE_SYSTEM_WALLET
- Double freeze → 422 WALLET_ALREADY_FROZEN
- Unfreeze non-frozen → 422 WALLET_NOT_FROZEN
- Duplicate wallet creation → 409 WALLET_ALREADY_EXISTS
- Full lifecycle: create → deposit → withdraw → freeze → unfreeze → withdraw all → close

### 9. Ledger Integrity
Test that the financial ledger is mathematically correct:
- All movements are zero-sum (SUM of ledger entries per movement_id = 0)
- Cached balance matches ledger sum per wallet
- No negative non-system wallet balances
- All transaction amounts are positive
- UPDATE on ledger_entries → blocked by immutable trigger
- DELETE on ledger_entries → blocked by immutable trigger
- DB constraint blocks negative balance via direct SQL

### 10. Edge Cases & Boundary Values
Test limits and unusual inputs:
- Minimum deposit (1 cent) → succeeds
- Cross-currency transfer → 400/422
- Non-existent wallet → 404
- Invalid UUID in path → 404/400
- Transfer to non-existent wallet → 404
- Capture non-existent hold → 404

### 11. Information Disclosure
Test that errors don't leak internal details:
- Error bodies don't contain "stack", "prisma", "postgres", "node_modules"
- No `X-Powered-By` header on any response
- Consistent 404 for existing wallet (wrong platform) vs non-existing wallet (prevents enumeration)

---

## Verifying DB State Directly

Use `getTestPrisma()` for direct database assertions:

```ts
import { getTestPrisma } from "@test/helpers/db.js";

it("Then ledger entries are zero-sum", async () => {
  const prisma = getTestPrisma();
  const results = await prisma.$queryRaw`
    SELECT movement_id, SUM(amount_cents) AS total
    FROM ledger_entries
    GROUP BY movement_id
  `;
  for (const row of results) {
    expect(Number(row.total)).toBe(0);
  }
});
```

**Note:** Prisma `$queryRaw` returns `Decimal` for `SUM()` of BigInt columns. Use `Number()` for comparisons.

---

## Concurrency Test Pattern

```ts
describe("Given a wallet with 50000 cents", () => {
  describe("When 10 concurrent A→B and 10 concurrent B→A transfers execute", () => {
    it("Then zero 500 errors occur (no deadlocks)", async () => {
      const results = await Promise.all([
        ...Array.from({ length: 10 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `ab-${i}-${Date.now()}` },
            body: JSON.stringify({
              source_wallet_id: walletA,
              target_wallet_id: walletB,
              amount_cents: 100,
            }),
          }),
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          app.request("/v1/transfers", {
            method: "POST",
            headers: { "Idempotency-Key": `ba-${i}-${Date.now()}` },
            body: JSON.stringify({
              source_wallet_id: walletB,
              target_wallet_id: walletA,
              amount_cents: 100,
            }),
          }),
        ),
      ]);

      const serverErrors = results.filter((r) => r.status >= 500);
      expect(serverErrors).toHaveLength(0); // No deadlocks

      // Some may be 409 (VERSION_CONFLICT) — that's expected and OK
      const conflicts = results.filter((r) => r.status === 409);
      const successes = results.filter((r) => r.status === 201);
      expect(successes.length + conflicts.length).toBe(20);
    });
  });
});
```

---

## Checklist Before Submitting E2E Tests

- [ ] All 12 security categories addressed (where applicable to the endpoint)
- [ ] The endpoint is covered by e2e tests; no endpoint change ships without e2e coverage updates
- [ ] `beforeEach` calls `app.reset()` (truncate + re-seed)
- [ ] Every mutation has unique `Idempotency-Key`
- [ ] Authenticated requests use `app.request()` (auto-includes API key)
- [ ] Cross-tenant tests use `app.attackerRequest()`
- [ ] Unauthenticated tests use `app.unauthenticatedRequest()`
- [ ] DB state verified via `getTestPrisma()` for financial assertions
- [ ] Error responses checked for correct status code AND error code
- [ ] Concurrency tests use `Promise.all()` and assert aggregate outcomes
- [ ] File named `*.e2e.test.ts` to match vitest.e2e.config.ts
- [ ] No hardcoded IDs — create data via API in test setup
