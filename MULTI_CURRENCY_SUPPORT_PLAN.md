# Multi-Currency Support Plan

## Goal

Officially support multiple currencies in the Wallet Service, with **phase 1 limited to USD, EUR, and MXN**.

This phase does **not** include FX conversion. A wallet transfer between different currencies must continue to be rejected until a dedicated conversion service exists.

The main design principle is:

**Treat the product as multiple isolated single-currency ledgers, not as one mixed-currency balance engine.**

That keeps accounting correct, keeps the current ledger model valid, and avoids introducing fake cross-currency balances before exchange-rate logic exists.

---

## Executive Summary

- The service is already structurally close to multi-currency support: wallets are per `owner + platform + currency`, system wallets are already per `platform + currency`, and transfers already reject currency mismatch.
- The biggest current gap is not schema design. The biggest gap is **currency policy**. Today the code mostly accepts any 3-letter uppercase code, which means the service is operationally more open than the product intends.
- For phase 1, we should make the system explicitly support only `USD`, `EUR`, and `MXN`, and make that rule visible in domain validation, HTTP validation, OpenAPI docs, tests, and operational tooling.
- Each platform/integrator should conceptually have one system wallet per supported currency. In the short term, lazy creation can stay. In the medium term, system wallets should be provisioned when a currency is enabled for a platform.
- We should **not** add cross-currency transfer logic inside the current transfer use case. Future FX must be a separate flow with quote/rate/fee tracking and linked single-currency ledger movements.

---

## What The Current Codebase Already Has

The current implementation already contains important building blocks:

- `Wallet` already stores `currency_code`, and the unique constraint is already `(owner_id, platform_id, currency_code)`.
- `CreateWalletUseCase` already ensures one system wallet per `(platform_id, currency_code)` and auto-creates it if missing.
- `TransferUseCase` already rejects transfers when source and target wallet currencies differ.
- Existing e2e tests already create wallets in `USD`, `EUR`, and `MXN` and verify that cross-currency transfers are rejected.
- The immutable-ledger SQL already treats `currency_code` as immutable on wallets.

Important codebase observations:

- `src/wallet/domain/wallet/wallet.aggregate.ts`
  Current validation is format-oriented: uppercase 3-letter code, not an explicit supported-currency catalog.
- `src/wallet/application/command/createWallet/usecase.ts`
  System wallets are created lazily on first wallet creation for that platform/currency.
- `src/wallet/application/command/transfer/usecase.ts`
  Same-currency enforcement already exists.
- `tests/e2e/wallet/edge-cases.e2e.test.ts`
  Same owner already creates `USD`, `EUR`, and `MXN` wallets independently.
- `prisma/immutable_ledger.sql`
  System wallet ledger chain validation is skipped because system wallet `balance_after_cents` is approximate under concurrency.

This means phase 1 is mostly about **hardening and formalizing** multi-currency support, not redesigning the service from scratch.

---

## Recommended Product Rules For Phase 1

### Currency scope

- Officially supported currencies are only `USD`, `EUR`, and `MXN`.
- Any other currency code must be rejected, even if it is a valid ISO 4217 code.
- Wallet currency is immutable after wallet creation.
- One owner may have multiple wallets in the same platform, but only one per currency.

### Ledger and balance rules

- Every wallet balance remains scoped to exactly one currency.
- Every movement, transaction, ledger entry, hold, deposit, withdrawal, adjustment, and hold capture remains single-currency.
- No endpoint may imply a cross-currency total unless an explicit conversion source is used.
- Cross-currency transfers remain rejected.

### System wallet rules

- There must be exactly one system wallet per `(platform_id, currency_code)`.
- System wallets remain internal-only counterparties for deposits, withdrawals, adjustments, and hold captures.
- System wallets cannot be frozen, closed, or deleted.
- A missing system wallet must be treated as an operational defect, not a normal business scenario.

### API and integrator rules

- Clients must always know the wallet currency they are operating on.
- Integrators must not assume that balances from different wallets can be added together without conversion.
- Cross-currency transfer requests must fail deterministically with a stable business error.

---

## Recommended System Wallet Strategy

### Recommendation

Use **one system wallet per platform per currency**.

This is already consistent with the current model and is the right shape for deposits, withdrawals, adjustments, and future reconciliation.

### Why this is the right rule

- It isolates accounting per platform and per currency.
- It keeps ledger counterparties simple and deterministic.
- It preserves tenant isolation.
- It makes reconciliation and reporting easier by currency.
- It is compatible with a future FX service, which can debit one currency ledger and credit another through linked conversion records.

### Short-term implementation choice

Keep the current **lazy creation** behavior for now:

- If a platform creates its first wallet in `EUR`, the `EUR` system wallet is created at that moment.
- If a platform never uses `MXN`, no `MXN` system wallet is created yet.

This is low-risk because the behavior already exists.

### Medium-term improvement

When platform-level currency enablement exists, move to **eager provisioning**:

- enabling `USD` for a platform creates the `USD` system wallet immediately
- enabling `EUR` creates the `EUR` system wallet immediately
- enabling `MXN` creates the `MXN` system wallet immediately

That is operationally cleaner because the platform is fully prepared before the first customer-facing request.

---

## Required Changes For Phase 1

## 1. Add an explicit supported-currency catalog

Today the code mostly validates format. We need a real product catalog.

Recommended approach:

- Add a canonical currency catalog in code with:
  `USD`, `EUR`, `MXN`
- Store metadata for each supported currency, even if phase 1 only uses:
  `code`, `minorUnit`
- Set `minorUnit = 2` for all three currencies.

Recommended location:

- `src/utils/kernel/` if the catalog is shared across bounded contexts
- or `src/wallet/domain/` if we want it initially scoped to Wallet BC

Why this matters:

- it gives one source of truth
- it prevents unsupported 3-letter codes from slipping through
- it prepares the codebase for future per-platform currency policies
- it prepares the codebase for future currencies with different metadata

## 2. Split format validation from support validation

We should distinguish:

- invalid currency format
- valid format but unsupported currency

Recommended error model:

- `INVALID_CURRENCY_FORMAT`
- `UNSUPPORTED_CURRENCY`

If we want to minimize error-surface changes, we can keep `INVALID_CURRENCY` for format and introduce only `UNSUPPORTED_CURRENCY` for unsupported but well-formed codes.

This matters because:

- `ABC` and `JPY` are different product problems from `USDX` or `12`
- logs and dashboards should show whether a request was malformed or merely not supported yet

## 3. Harden wallet creation rules

`createWallet` must become the main enforcement point for the supported-currency policy.

Required behavior:

- accept only `USD`, `EUR`, `MXN`
- keep currency immutable
- continue enforcing one wallet per `(owner, platform, currency)`
- continue ensuring that the matching system wallet exists

Important note:

The domain currently uppercases currency codes internally, while the HTTP schema for `createWallet` currently only accepts uppercase input.

Recommended decision:

- keep the API strict and require uppercase from clients
- keep internal uppercase normalization anyway as a defense-in-depth measure

That gives a clean public contract without making the internals fragile.

## 4. Decide whether all platforms get all 3 currencies immediately

There are two viable product models.

### Option A: global support for all platforms

Every platform can create wallets in `USD`, `EUR`, and `MXN`.

Pros:

- simplest implementation
- no new database table required
- good enough if all integrators are intended to use the same catalog

Cons:

- weaker operational control
- no platform-specific rollout or staged launch

### Option B: per-platform currency enablement

Each platform explicitly enables the currencies it is allowed to use.

Pros:

- safer rollout
- better operational control
- future-friendly for compliance, treasury, and business configuration

Cons:

- needs new data model and policy lookup
- slightly more moving pieces in create-wallet and onboarding flows

### Recommendation

For phase 1, implement the code so it can evolve toward Option B, but choose one of these two rollout paths:

- simplest short-term path: use Option A now
- better medium-term path: add Option B before exposing the feature broadly

If the product expects only a few trusted integrators at first, Option A is acceptable.
If the product expects staged rollouts or commercial restrictions, Option B is the better foundation.

## 5. Add platform-currency configuration if Option B is chosen

If we choose per-platform currency enablement, add a new table such as:

`platform_currency_settings`

Suggested fields:

- `id`
- `platform_id`
- `currency_code`
- `status` (`enabled`, `disabled`)
- `created_at`
- `updated_at`
- optional `enabled_at`
- optional `disabled_at`

Suggested rules:

- enabling a currency provisions the system wallet for that platform/currency
- disabling a currency must not delete wallets or balances
- disabling a currency should block new wallet creation in that currency

Recommended business rule for disabled currencies with existing balances:

- keep reads allowed
- keep controlled exits possible
- block new expansion of exposure

In practice that usually means:

- block new wallet creation
- block new deposits and new positive adjustments
- allow withdrawals or controlled drain-down if product policy requires it

This policy must be decided explicitly before implementation.

## 6. Update HTTP validation and API documentation

Required changes:

- `createWallet` request schema should stop behaving like "any uppercase 3 letters are fine"
- OpenAPI docs should state that only `USD`, `EUR`, and `MXN` are supported
- transfer docs should explicitly state that cross-currency transfers are rejected

Possible implementation choices:

- If support is global and static, the HTTP schema can use an enum for `USD | EUR | MXN`
- If support becomes platform-specific, keep transport validation format-based and enforce support in the application layer

Recommendation:

- use enum validation only if the supported set is truly static at API level
- use application-layer support checks if platform-specific policy is coming soon

## 7. Audit and possibly constrain the database

There is no mandatory schema redesign for phase 1, but there is mandatory policy hardening.

Required steps:

- audit existing wallet rows and identify any currency outside `USD`, `EUR`, `MXN`
- audit existing platform/currency combinations and verify system wallets exist
- backfill missing system wallets if needed

Possible database hardening:

- add a `CHECK` constraint on `wallets.currency_code IN ('USD', 'EUR', 'MXN')`

Tradeoff:

- this is strong and simple if the supported set is truly global
- this becomes friction if new currencies are added often
- this does not model per-platform enablement

Recommendation:

- if phase 1 is global and static, a DB check is acceptable
- if per-platform enablement is likely soon, prefer app-level validation plus configuration tables

## 8. Add a reconciliation/repair path for system wallets

System wallets are too important to rely only on lazy creation plus business traffic.

Add at least one of these:

- startup verification that no used `(platform, currency)` pair is missing its system wallet
- a repair command or script to create missing system wallets idempotently
- health monitoring for missing system wallets

This should be part of operations, not only business logic.

## 9. Expand tests around official currency support

Required unit and e2e coverage:

- creating wallets in `USD`, `EUR`, and `MXN`
- rejecting a valid-but-unsupported code like `JPY` or `GBP`
- rejecting malformed currency codes
- same owner having 3 wallets in 3 supported currencies
- deposits, withdrawals, holds, and adjustments staying isolated per wallet currency
- cross-currency transfer rejection with stable error code
- system wallet creation per platform per currency
- backfill or repair behavior for missing system wallets

If platform-currency enablement is added, also test:

- platform allowed to use `USD` but not `EUR`
- platform disabled for a currency after wallets already exist
- cross-tenant and disabled-currency edge cases

## 10. Improve observability by currency

Add currency awareness to logs, monitoring, and runbooks.

Recommended additions:

- include `currency_code` in relevant logs
- expose metrics segmented by currency
- monitor system wallet counts by `(platform, currency)`
- monitor balances and movement volume by currency
- track `UNSUPPORTED_CURRENCY` and `CURRENCY_MISMATCH` errors

This matters because multi-currency failures are often operational before they are functional.

---

## Important Limitations In Phase 1

## 1. No FX conversion

This phase must not pretend to support conversion.

That means:

- no cross-currency transfer
- no exchange-rate storage
- no quote locking
- no spread or FX fee model
- no conversion settlement model
- no reversal logic for partially completed conversions

## 2. `amount_cents` is acceptable only because all 3 phase-1 currencies use 2 decimals

The current API naming is workable for `USD`, `EUR`, and `MXN` because all three use 2 minor decimals.

But this is a future limitation.

If we later add currencies like:

- `JPY` with 0 decimals
- `BHD` with 3 decimals

then `amount_cents` becomes a misleading public contract, even if the internal docs say it really means the smallest unit.

Recommended future solution:

- keep `amount_cents` for this phase
- plan a future migration toward a neutral name such as `amount_minor`
- if renaming is expensive, introduce `amount_minor` in a versioned API instead of retrofitting silently

## 3. No trustworthy cross-currency totals

Without FX, there is no meaningful way to say:

- total balance of an owner across currencies
- total platform exposure across currencies
- total funds under custody in one single denomination

Any such number would require:

- a quote source
- a valuation timestamp
- a rate policy

Until then, totals must remain currency-scoped.

## 4. System wallet ledger snapshots are approximate under concurrency

This is already true today and becomes more important as multi-currency usage grows.

Current behavior:

- system wallets use atomic balance increments
- system wallet `balance_after_cents` in ledger entries is computed from an in-memory snapshot
- ledger chain validation and reconciliation skip system wallets

Why this matters:

- it is acceptable for an internal counterparty wallet under the current model
- it is not ideal if system wallet per-entry balance snapshots become a finance-grade audit requirement

Future improvement options:

- serialize system-wallet balance snapshot generation
- assign a per-wallet ledger sequence
- compute authoritative post-balance in the database after increment
- expose system-wallet reporting through aggregate reconciliation instead of trusting every `balance_after_cents` snapshot

This does not block phase 1, but it should be documented as an architectural debt.

---

## What We Should Not Change In Phase 1

- Do not allow wallet currency changes.
- Do not allow cross-currency transfers.
- Do not overload the current `TransferUseCase` with FX semantics.
- Do not build a fake "global balance" endpoint across currencies.
- Do not expose cross-currency sums in dashboards without valuation metadata.
- Do not add currencies with non-2-decimal minor units yet.

Keeping phase 1 narrow is what protects ledger correctness.

---

## Future-Safe Design For FX Conversion

When the conversion service exists, it should be treated as a separate business capability, not as a small extension of the current transfer flow.

### Why the current transfer model is not enough

The current transfer flow assumes:

- one amount
- one currency
- one movement that stays zero-sum inside one currency context

FX breaks that assumption because there are always at least:

- source amount
- target amount
- exchange rate
- possible fee or spread
- quote timestamp and expiry

### Recommended FX design direction

Use a dedicated FX orchestration flow with:

- a quote record
- a conversion record
- source currency amount
- target currency amount
- exchange rate plus scale
- fee or spread fields
- provider or pricing source
- timestamps for quote creation, locking, execution, and settlement

### Ledger recommendation for future FX

Do **not** represent an FX conversion as one fake mixed-currency movement.

Instead:

- keep zero-sum intact inside each currency ledger
- create one balanced movement in source currency
- create one balanced movement in target currency
- link both through a higher-level `conversion_id`

That preserves ledger integrity and keeps each currency internally coherent.

### Treasury recommendation for future FX

Platform system wallets are not enough for real FX.

Future FX will likely need:

- treasury wallets per currency
- provider or settlement bridge wallets
- exposure tracking by currency
- settlement and reconciliation flows

That is separate from the current platform system wallet concept.

The platform system wallet is a product counterparty.
An FX treasury wallet is a real inventory and settlement concern.

Those should not be conflated.

---

## Suggested Rollout Plan

## Phase 1A: Formalize the supported catalog

- define supported currencies in code
- split format validation from support validation
- update docs and OpenAPI
- add tests for unsupported but well-formed codes

## Phase 1B: Harden operational guarantees

- audit existing data
- backfill missing system wallets
- add monitoring and repair tooling
- optionally add DB-level currency constraint

## Phase 1C: Decide platform policy

- either allow all 3 currencies for all platforms
- or add per-platform currency enablement

Recommendation:

- if the rollout is small and controlled, global support is acceptable first
- if the rollout needs control, do per-platform enablement before launch

## Phase 2: Platform-specific enablement

- add platform-currency settings
- provision system wallets on enablement
- define disabled-currency behavior for existing balances

## Phase 3: FX service

- quote model
- conversion model
- treasury/bridge wallets
- linked single-currency movements
- fees, spread, settlement, and reconciliation

---

## Open Questions To Resolve Before Implementation

- Should every platform automatically get `USD`, `EUR`, and `MXN`, or should currencies be enabled explicitly per platform?
- If a currency is later disabled for a platform, which operations remain allowed on existing wallets?
- Do we want lazy system wallet creation for phase 1 only, or do we want eager provisioning before launch?
- Do we need a public endpoint for supported or platform-enabled currencies?
- Do finance or operations teams need stronger guarantees on system-wallet `balance_after_cents` before multi-currency goes live?

---

## Final Recommendation

The safest path is:

- keep the current ledger model
- officially support only `USD`, `EUR`, and `MXN`
- make support explicit through a real currency catalog
- keep wallets, balances, and ledger movements strictly single-currency
- keep one system wallet per platform per currency
- reject all cross-currency transfers until FX exists
- design FX later as linked single-currency movements, not as a shortcut inside the current transfer flow

That gives the product real multi-currency support now without corrupting accounting semantics or painting the future FX design into a corner.
