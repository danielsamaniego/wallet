# BDD Style Guide -- Given/When/Then Convention

> Every test in this project follows strict BDD structure using `describe` / `it` blocks.

---

## The Given/When/Then Convention

Tests are structured as nested `describe` blocks with a maximum of **3 nesting levels**:

```
describe("Aggregate or UseCase Name")        // Top-level: system under test
  describe("Given <precondition>")           // Level 1: state setup
    describe("When <action>")                // Level 2: trigger
      it("Then <expected outcome>")          // Level 3: assertion
```

### Concrete Example

```ts
describe("Wallet Aggregate", () => {
  describe("deposit", () => {
    describe("Given an active wallet with balance 1000 minor units", () => {
      describe("When depositing 500 minor units", () => {
        it("Then balance becomes 1500 minor units", () => {
          const w = activeWallet(1000n);
          w.deposit(500n, LATER);
          expect(w.cachedBalanceMinor).toBe(1500n);
        });

        it("Then version increments by 1", () => {
          const w = activeWallet(1000n);
          w.deposit(500n, LATER);
          expect(w.version).toBe(2);
        });
      });
    });
  });
});
```

---

## Max 3 Nesting Levels

The nesting depth rule (Given -> When -> Then) exists to keep tests scannable:

```
describe("DepositUseCase")                                    // SUT
  describe("Given an active user wallet and a system wallet") // precondition
    describe("When depositing 5000 minor units")                    // action
      it("Then it returns the transactionId and movementId")  // assertion
      it("Then the user wallet balance is updated")           // assertion
      it("Then a Movement is created with type 'deposit'")    // assertion
```

If you need more context, add it to the Given description string, NOT by adding another nesting level.

**Wrong -- 4 levels:**
```ts
describe("Given an active wallet", () => {
  describe("And the wallet has USD currency", () => {  // <-- extra level
    describe("When depositing", () => {
      it("Then ...", () => {});
    });
  });
});
```

**Right -- context in the Given string:**
```ts
describe("Given an active USD wallet with balance 1000 minor units", () => {
  describe("When depositing 500 minor units", () => {
    it("Then balance becomes 1500 minor units", () => {});
  });
});
```

---

## One `it("Then ...")` Per Logical Assertion

Each `it` block tests ONE logical outcome. This means:

- One state change per `it` (balance changed, version incremented, status changed)
- One side effect per `it` (repo.save called, transaction created, ledger entries created)
- One error per `it` (throws WALLET_NOT_FOUND)

Multiple `expect()` calls are allowed WITHIN one `it` when they verify the same logical outcome (e.g., checking both `kind` and `code` of an error, or checking all fields of a created entity).

**Good -- single logical assertion:**
```ts
it("Then a Transaction is created with type 'deposit' and status 'completed'", async () => {
  await sut.handle(ctx, cmd);
  const tx = transactionRepo.save.mock.calls[0]![1] as Transaction;
  expect(tx.type).toBe("deposit");
  expect(tx.status).toBe("completed");
  expect(tx.amountMinor).toBe(5000n);
});
```

**Bad -- multiple unrelated assertions:**
```ts
it("Then everything works", async () => {
  const result = await sut.handle(ctx, cmd);
  expect(result.transactionId).toBe("tx-1");     // return value
  expect(walletRepo.save).toHaveBeenCalled();     // side effect -- separate concern
  expect(ledgerEntryRepo.saveMany).toHaveBeenCalled(); // another side effect
});
```

---

## Factory Functions to Avoid Mutation Leaks

Domain aggregates are mutable. Never share a single instance between `it` blocks -- each test must create its own fresh instance via factory functions.

**Right -- factory function returns fresh instance per call:**
```ts
const activeWallet = (balance = 0n, id = "w-1") =>
  Wallet.reconstruct(id, "owner-1", "platform-1", "USD", balance, "active", 1, false, NOW, NOW);

it("Then balance becomes 1500 minor units", () => {
  const w = activeWallet(1000n);  // fresh instance
  w.deposit(500n, LATER);
  expect(w.cachedBalanceMinor).toBe(1500n);
});

it("Then version increments by 1", () => {
  const w = activeWallet(1000n);  // another fresh instance
  w.deposit(500n, LATER);
  expect(w.version).toBe(2);
});
```

**Wrong -- shared mutable instance:**
```ts
const w = activeWallet(1000n);  // shared -- mutations leak between tests!

it("Then balance becomes 1500", () => {
  w.deposit(500n, LATER);
  expect(w.cachedBalanceMinor).toBe(1500n);
});

it("Then version increments", () => {
  // BROKEN: w.balance is already 1500 and version is already 2 from previous test
  w.deposit(500n, LATER);
  expect(w.version).toBe(2);  // Actually 3!
});
```

For use case tests, use `WalletBuilder` inside `beforeEach` to create fresh builders:

```ts
beforeEach(() => {
  walletRepo.findById.mockResolvedValue(
    new WalletBuilder()
      .withId("wallet-1")
      .withPlatformId("platform-1")
      .withBalance(10000n)
      .build(),
  );
});
```

---

## Naming Rules

### `describe` blocks

- **Top-level:** Name of the class or module being tested.
  - `describe("Wallet Aggregate")`
  - `describe("DepositUseCase")`
- **Method grouping (optional):** Name of the method.
  - `describe("deposit")`
  - `describe("freeze")`
- **Given:** Start with `"Given"` and describe the precondition in plain English.
  - `"Given an active wallet with balance 1000 minor units"`
  - `"Given the wallet does not exist"`
  - `"Given a wallet belonging to a different platform"`
- **When:** Start with `"When"` and describe the action.
  - `"When depositing 500 minor units"`
  - `"When freezing"`
  - `"When a transfer of $25.00 is executed"`

### `it` blocks

- **Always** start with `"Then"`.
- Use **specific, measurable** language.
- Include the expected value in the description when possible.

| Good                                              | Bad                          |
|---------------------------------------------------|------------------------------|
| `"Then balance becomes 1500 minor units"`               | `"should work"`              |
| `"Then throws WALLET_NOT_ACTIVE"`                 | `"handles error"`            |
| `"Then version increments by 1"`                  | `"updates correctly"`        |
| `"Then status becomes frozen"`                    | `"it freezes"`               |
| `"Then it returns the transactionId"`             | `"returns data"`             |
| `"Then throws INSUFFICIENT_FUNDS"`                | `"fails when no money"`      |

---

## Anti-Patterns

### 1. Vague test names

```ts
// BAD
it("should work", () => { ... });
it("handles the error case", () => { ... });
it("returns the right thing", () => { ... });

// GOOD
it("Then balance becomes 1500 minor units", () => { ... });
it("Then throws WALLET_NOT_ACTIVE", () => { ... });
it("Then it returns transactionId and movementId", () => { ... });
```

### 2. Testing implementation details

Test **observable behavior** (return values, state changes, repo calls), not private internals.

```ts
// BAD -- testing internal field name
expect((w as any)._status).toBe("active");

// GOOD -- testing public getter
expect(w.status).toBe("active");
```

### 3. Multiple unrelated assertions in one `it`

```ts
// BAD -- mixing return value check with side effect checks
it("Then deposit succeeds", async () => {
  const result = await sut.handle(ctx, cmd);
  expect(result.transactionId).toBe("tx-1");
  expect(walletRepo.save).toHaveBeenCalledOnce();
  expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
});

// GOOD -- split into focused tests
it("Then it returns the transactionId and movementId", async () => {
  const result = await sut.handle(ctx, cmd);
  expect(result).toEqual({ transactionId: "tx-1", movementId: "mov-1" });
});

it("Then the user wallet balance is updated", async () => {
  await sut.handle(ctx, cmd);
  const savedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
  expect(savedWallet.cachedBalanceMinor).toBe(15000n);
});
```

### 4. Missing Given/When/Then structure

```ts
// BAD -- flat tests without BDD structure
it("deposit 500 into wallet with 1000 balance", () => { ... });
it("deposit into frozen wallet throws", () => { ... });

// GOOD -- proper BDD nesting
describe("Given an active wallet with balance 1000 minor units", () => {
  describe("When depositing 500 minor units", () => {
    it("Then balance becomes 1500 minor units", () => { ... });
  });
});
```

### 5. Using `should` instead of `Then`

This project uses `Then` as the `it` prefix, not `should`:

```ts
// BAD
it("should throw WALLET_NOT_ACTIVE", () => { ... });

// GOOD
it("Then throws WALLET_NOT_ACTIVE", () => { ... });
```
