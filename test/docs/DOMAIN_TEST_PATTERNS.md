# Domain Test Patterns

> How to test aggregates and entities in `src/wallet/domain/`. Zero mocks, pure logic.

---

## Principles

1. **Zero mocks.** Domain tests import ONLY from `@/wallet/domain/` and `@/utils/kernel/`.
2. **Factory functions** at the top of the file create fresh instances using `reconstruct()`.
3. **State x Action matrix** -- for every method, enumerate ALL possible states and test each combination.
4. **Custom matcher** `toThrowAppError(ErrorKind.X, "CODE")` for synchronous domain errors.
5. **Each `it` block** creates its own instance to avoid mutation leaks.

---

## Copy-Paste Template: Aggregate/Entity Test

```ts
import { describe, it, expect } from "vitest";
import { MyEntity } from "@/wallet/domain/myEntity/myEntity.entity.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Timestamps ──────────────────────────────────────────────────────
const NOW = 1700000000000;
const LATER = NOW + 1000;

// ── Factory functions (fresh instance per call) ─────────────────────
const activeEntity = (overrides?: { balance?: bigint; id?: string }) =>
  MyEntity.reconstruct({
    id: overrides?.id ?? "entity-1",
    // ... all required fields with sensible defaults ...
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  });

const frozenEntity = () =>
  MyEntity.reconstruct({
    id: "entity-1",
    // ...
    status: "frozen",
    createdAt: NOW,
    updatedAt: NOW,
  });

const closedEntity = () =>
  MyEntity.reconstruct({
    id: "entity-1",
    // ...
    status: "closed",
    createdAt: NOW,
    updatedAt: NOW,
  });

// ── Tests ───────────────────────────────────────────────────────────
describe("MyEntity", () => {
  // ── create ──────────────────────────────────────────────────────
  describe("create", () => {
    describe("Given valid parameters", () => {
      describe("When creating", () => {
        it("Then creates with correct initial state", () => {
          const e = MyEntity.create(/* valid args */);
          expect(e.status).toBe("active");
          expect(e.version).toBe(1);
        });
      });
    });

    describe("Given invalid parameter X", () => {
      describe("When creating", () => {
        it("Then throws INVALID_X", () => {
          expect(() => MyEntity.create(/* invalid args */))
            .toThrowAppError(ErrorKind.Validation, "INVALID_X");
        });
      });
    });
  });

  // ── methodName ──────────────────────────────────────────────────
  describe("methodName", () => {
    // Happy path
    describe("Given an active entity", () => {
      describe("When calling methodName with valid args", () => {
        it("Then state changes as expected", () => {
          const e = activeEntity();
          e.methodName(/* args */, LATER);
          expect(e.someField).toBe(/* expected */);
        });

        it("Then version increments", () => {
          const e = activeEntity();
          e.methodName(/* args */, LATER);
          expect(e.version).toBe(2);
        });

        it("Then updatedAt changes", () => {
          const e = activeEntity();
          e.methodName(/* args */, LATER);
          expect(e.updatedAt).toBe(LATER);
        });
      });
    });

    // Error paths for every other state
    describe("Given a frozen entity", () => {
      describe("When calling methodName", () => {
        it("Then throws ENTITY_NOT_ACTIVE", () => {
          const e = frozenEntity();
          expect(() => e.methodName(/* args */, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "ENTITY_NOT_ACTIVE");
        });
      });
    });

    describe("Given a closed entity", () => {
      describe("When calling methodName", () => {
        it("Then throws ENTITY_NOT_ACTIVE", () => {
          const e = closedEntity();
          expect(() => e.methodName(/* args */, LATER))
            .toThrowAppError(ErrorKind.DomainRule, "ENTITY_NOT_ACTIVE");
        });
      });
    });
  });

  // ── reconstruct ─────────────────────────────────────────────────
  describe("reconstruct", () => {
    describe("Given arbitrary field values", () => {
      describe("When reconstructing", () => {
        it("Then all getters return the provided values", () => {
          const e = MyEntity.reconstruct({
            id: "r-id",
            // ... all fields with distinct test values
          });
          expect(e.id).toBe("r-id");
          // ... assert every getter
        });
      });
    });
  });
});
```

---

## RULE: State x Action Matrix

For the Wallet aggregate, the matrix looks like this:

| State \ Action | `deposit` | `withdraw` | `freeze` | `unfreeze` | `close` | `touchForHoldChange` |
|----------------|-----------|------------|----------|------------|---------|----------------------|
| **active**     | OK (balance up) | OK (balance down, check funds) | OK (-> frozen) | ERR `WALLET_NOT_FROZEN` | OK if balance=0 & holds=0 | OK (version up) |
| **active+system** | OK | OK (allows negative) | ERR `CANNOT_FREEZE_SYSTEM_WALLET` | ERR `WALLET_NOT_FROZEN` | ERR `CANNOT_CLOSE_SYSTEM_WALLET` | OK |
| **frozen**     | ERR `WALLET_NOT_ACTIVE` | ERR `WALLET_NOT_ACTIVE` | ERR `WALLET_ALREADY_FROZEN` | OK (-> active) | OK if balance=0 & holds=0 | ERR `WALLET_NOT_ACTIVE` |
| **closed**     | ERR `WALLET_NOT_ACTIVE` | ERR `WALLET_NOT_ACTIVE` | ERR `WALLET_CLOSED` | ERR `WALLET_NOT_FROZEN` | ERR `WALLET_CLOSED` | ERR `WALLET_NOT_ACTIVE` |

For the Hold entity:

| State \ Action | `capture` | `void_` | `expire` | `isExpired(now)` |
|----------------|-----------|---------|----------|------------------|
| **active**     | OK (-> captured) | OK (-> voided) | OK (-> expired) | true if expiresAt <= now, false otherwise |
| **captured**   | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | false (not active) |
| **voided**     | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | false (not active) |
| **expired**    | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | ERR `HOLD_NOT_ACTIVE` | false (not active) |

**Every cell in the matrix MUST have a corresponding test.** This is how we guarantee 100% branch coverage on domain logic.

---

## Using `toThrowAppError`

The custom matcher `toThrowAppError(kind, code)` is defined in `test/helpers/setup.ts` and works with **synchronous** functions only.

```ts
// Synchronous domain method -- use toThrowAppError directly
expect(() => wallet.deposit(0n, LATER))
  .toThrowAppError(ErrorKind.Validation, "INVALID_AMOUNT");

expect(() => frozenWallet.deposit(100n, LATER))
  .toThrowAppError(ErrorKind.DomainRule, "WALLET_NOT_ACTIVE");
```

For **async** functions (use cases), use `rejects.toSatisfy` instead:

```ts
await expect(sut.handle(ctx, cmd)).rejects.toSatisfy((err: AppError) => {
  return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
});
```

---

## Using Factory Functions (Not Builders) for Domain Tests

Domain tests use simple factory functions (not `WalletBuilder`). This keeps domain tests free of test-helper dependencies and makes the `reconstruct()` call explicit:

```ts
// Factory with optional overrides via parameters
const activeWallet = (balance = 0n, id = "w-1") =>
  Wallet.reconstruct(id, "owner-1", "platform-1", "USD", balance, "active", 1, false, NOW, NOW);

// Factory for specific state
const systemWallet = (balance = 0n) =>
  Wallet.reconstruct("sys-1", "SYSTEM", "platform-1", "USD", balance, "active", 1, true, NOW, NOW);

// Factory with object-style overrides (used by Hold)
const activeHold = (overrides?: Partial<Parameters<typeof Hold.reconstruct>[0]>) =>
  Hold.reconstruct({
    id: "hold-1",
    walletId: "wallet-1",
    amountMinor: 1000n,
    status: "active",
    reference: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
```

---

## Edge Cases to Always Test

For **amount-based operations** (deposit, withdraw, transfer):
- Zero amount -> `INVALID_AMOUNT`
- Negative amount -> `INVALID_AMOUNT`
- Minimum valid amount (1 cent / 1n)
- Exact boundary (withdraw exactly available balance)
- Just over boundary (withdraw available + 1)

For **state transitions**:
- Every invalid origin state (frozen, closed, already-in-target-state)
- System wallet special rules (bypass funds check, cannot freeze, cannot close)

For **time-based logic**:
- `expiresAt` in the past
- `expiresAt` exactly equal to `now` (boundary)
- `expiresAt` in the future
- `expiresAt` is null (never expires)

---

## Checklist Before Submitting a Domain Test

- [ ] Every public method of the aggregate/entity has tests.
- [ ] The State x Action matrix is fully covered.
- [ ] Every `throw` / `AppError` in the source has a corresponding `it`.
- [ ] Factory functions are used (no shared mutable instances).
- [ ] Only imports from `@/wallet/domain/` and `@/utils/kernel/`.
- [ ] `pnpm test:coverage` shows 100% for the source file.
