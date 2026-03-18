# Domain Model — Wallet Service

Wallet Service is a standalone digital wallet microservice that platforms integrate via REST API. This document describes the domain, actors, concepts, flows, and business rules.

---

## Vision

### What is the Wallet Service?

A digital wallet backend-as-a-service. Platforms (e-commerce, fintech, marketplaces) authenticate with API keys and manage wallets on behalf of their end users. The service handles deposits, withdrawals, P2P transfers, holds/authorizations, and maintains an immutable double-entry ledger.

### Problem Solved

- **Platforms**: Offload wallet logic, ledger, and race-condition handling without building custom financial infrastructure.
- **End users**: Hold balances and perform transactions (deposits, withdrawals, transfers) through platforms that integrate the Wallet Service.

---

## Actors

### 1. Platforms (API Consumers)

External systems that integrate the Wallet Service.

**Responsibilities:**
- Authenticate with API keys
- Create wallets for their end users
- Initiate deposits, withdrawals, transfers, holds
- Query balances and transaction history

**Capabilities:**
- REST API access; all operations require valid API key
- Idempotency keys for safe retries on mutations

### 2. End Users (Via Platforms)

Users of platforms that use the Wallet Service. They never interact directly with the service; they interact via the platform’s application.

**Responsibilities:**
- Hold balances in wallets
- Receive deposits, withdrawals, P2P transfers
- Have funds reserved via holds (e.g., pre-authorization for payments)

### 3. System (Internal)

Internal components and workflows.

**Responsibilities:**
- Maintain system wallets as counterparty for deposits and withdrawals
- Enforce business rules, constraints, and concurrency control
- Append immutable ledger entries for auditability

---

## Concepts

| Concept | Description |
|---------|-------------|
| **Wallet** | Per-owner, per-platform, per-currency balance container. Holds `cached_balance_cents` and `available_balance` (cached minus active holds). |
| **Transaction** | Record of a financial operation (deposit, withdrawal, transfer, hold capture). Links to ledger entries; amount always positive. |
| **LedgerEntry** | Single line in the double-entry ledger. CREDIT or DEBIT with `amount_cents` (signed) and `balance_after_cents`. Append-only, immutable. |
| **Hold** | Authorization that reserves funds without moving them. Lifecycle: active → captured \| voided \| expired. |
| **Platform** | API consumer. Identified by API key; owns wallets for its users. |
| **System Wallet** | Special wallet (e.g., per-currency omnibus) acting as counterparty for deposits and withdrawals. May have negative balance. |
| **Amount** | Integer cents (smallest currency unit). No floats; like Stripe. |
| **Currency** | ISO 4217 code (e.g., USD, EUR). Each wallet has one currency. |

---

## Flows

### Flow 1: Create Wallet

1. Platform provides `owner_id`, `platform_id`, `currency_code`.
2. Service validates uniqueness: one wallet per (owner_id, platform_id, currency_code).
3. Wallet created with `status=active`, `cached_balance_cents=0`, `version=0`.

### Flow 2: Deposit

1. Platform provides wallet ID, amount in cents, idempotency key.
2. Service credits wallet and debits system wallet.
3. Two ledger entries created (CREDIT for user, DEBIT for system).
4. `cached_balance_cents` updated; transaction recorded.

### Flow 3: Withdraw

1. Platform provides wallet ID, amount in cents, idempotency key.
2. Service validates `available_balance >= amount`.
3. Service debits wallet and credits system wallet.
4. Two ledger entries; `cached_balance_cents` updated.

### Flow 4: Transfer (P2P)

1. Platform provides source wallet, target wallet, amount, idempotency key.
2. Service validates both wallets active; source `available_balance >= amount`.
3. Atomic debit from source, credit to target.
4. Four ledger entries (debit + credit per wallet); two transactions (transfer_out, transfer_in).

### Flow 5: Place Hold

1. Platform provides wallet ID, amount, optional reference, optional `expires_at`.
2. Service validates `available_balance >= amount`.
3. Hold created with `status=active`.
4. No ledger entries; `available_balance` decreases by hold amount.

### Flow 6: Capture Hold

1. Platform provides hold ID, idempotency key.
2. Hold must be `active`.
3. Hold marked `captured`; debit from wallet, credit to counterpart (e.g., recipient wallet or system).
4. Ledger entries created; `cached_balance_cents` updated.

### Flow 7: Void Hold

1. Platform provides hold ID.
2. Hold marked `voided`.
3. Reserved funds released; `available_balance` increases.

### Flow 8: Freeze / Unfreeze

1. Platform provides wallet ID.
2. `status` set to `frozen` or `active`.
3. Frozen wallets: no deposits, withdrawals, transfers, or new holds.

### Flow 9: Close Wallet

1. Platform provides wallet ID.
2. Wallet must have zero balance and no active holds.
3. `status` set to `closed`.
4. Wallet cannot be used for further operations.

---

## Business Rules

### Amounts and Currency

- All amounts stored as integer cents (BIGINT). No floating point.
- Each wallet has exactly one currency (ISO 4217).
- `currency_code` must be a valid ISO 4217 uppercase code (e.g., USD, EUR). Domain validates against an allowed set; reject unknown codes.
- **Cross-currency transfers are not allowed.** Source and target wallets must share the same `currency_code`. The transfer command must validate this before proceeding.

### Double-Entry Ledger

- Every financial operation produces at least one debit and one credit.
- Ledger entries are append-only and immutable (DB trigger prevents UPDATE/DELETE).
- `entry_type`: CREDIT or DEBIT; `amount_cents` is signed (+ for credit, - for debit).
- `balance_after_cents` stores running balance snapshot after each entry.

### System Wallet

- System wallets (`is_system = true`) act as counterparty for deposits and withdrawals.
- System wallets may have negative balance (e.g., net withdrawals exceed deposits).
- **One system wallet per platform + currency.** When a platform's first wallet is created for a given currency, a system wallet is auto-created for that (platform_id, currency_code) pair with `owner_id = "SYSTEM"`, `is_system = true`.
- System wallets are created inside the `createWallet` command handler (or a dedicated `ensureSystemWallet` domain service) within the same transaction. If the system wallet already exists, the creation is a no-op (idempotent via unique constraint on `owner_id, platform_id, currency_code`).
- System wallets cannot be frozen or closed.

### Holds

- Holds reserve funds but do not move them.
- `available_balance = cached_balance_cents - sum(active_holds)`.
- Hold lifecycle: `active` → `captured` | `voided` | `expired`.
- **Expiration strategy**: Expired holds are detected **on-access** (when calculating available_balance or performing operations on the wallet) and **via batch job** (periodic cron that marks expired holds as `expired` and releases reserved funds). Both mechanisms must be implemented for correctness at scale.

### Wallet Status

- `active`: Normal operations allowed.
- `frozen`: No mutations (deposit, withdraw, transfer, hold).
- `closed`: Irreversible; no further operations.

### Concurrency and Safety

- **Optimistic locking**: Wallets have `version`; all mutations (single and multi-wallet) must match current version. On version mismatch (0 rows updated), the command returns `409 Conflict` with code `VERSION_CONFLICT`. The platform (client) retries with the same idempotency key. No automatic server-side retry — the client controls retry policy.
- **No pessimistic locking (SELECT FOR UPDATE)**: We deliberately avoid `SELECT FOR UPDATE` in the domain layer. It is a SQL-specific concept that would leak infrastructure into domain ports, breaking hexagonal architecture. If we switched to MongoDB or DynamoDB, pessimistic row locking doesn't exist. Optimistic locking via `version` is database-agnostic and catches all conflicts. If high-contention scenarios require it, pessimistic locking can be added inside the persistence adapter as an implementation detail, transparent to the domain.
- **Idempotency keys**: Required for all mutations (deposit, withdraw, transfer, hold capture). Duplicate keys return the cached response without re-executing. See Idempotency section.
- **DB constraints**: Uniqueness, referential integrity, positive amounts, and balance checks as safety net.

### Idempotency

- All mutations require an `Idempotency-Key` header.
- The idempotency store uses an **atomic acquire pattern**: INSERT a pending record before handler execution. If the INSERT conflicts (key already exists), return the stored response. This prevents race conditions where two concurrent requests with the same key both execute.
- Idempotency records have a 48h TTL (`expires_at`).
- **Cleanup**: A periodic batch job (cron) must delete records where `expires_at < now()`. Without cleanup, the `idempotency_records` table grows indefinitely. At scale (1M+ tx/day), consider partitioning by `created_at` via `pg_partman`.

---

## Transaction Types

| Type | Description |
|------|-------------|
| `deposit` | Funds credited to wallet (debit: system wallet) |
| `withdrawal` | Funds debited from wallet (credit: system wallet) |
| `transfer_in` | Funds received from another wallet |
| `transfer_out` | Funds sent to another wallet |
| `hold_capture` | Hold converted to actual debit (e.g., payment completion) |

---

## Wallet Statuses

| Status | Allowed Operations |
|--------|--------------------|
| `active` | All operations allowed |
| `frozen` | Read-only; no mutations |
| `closed` | No operations; wallet retired |

---

## Hold Lifecycle

```
active ──► captured   (hold converted to debit)
     └──► voided     (hold released, no debit)
     └──► expired    (time-based release)
```
