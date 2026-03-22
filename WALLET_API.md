# Wallet API — Integration Guide

Digital wallet microservice that provides deposits, withdrawals, transfers, authorization holds, and a double-entry immutable ledger. Designed for multi-tenant platforms (e.g., marketplaces, payment processors) where each platform manages wallets for its users.

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Idempotency](#idempotency)
- [Error Handling](#error-handling)
- [Pagination & Filtering](#pagination--filtering)
- [Endpoints](#endpoints)
  - [Health Check](#health-check)
  - [Wallets](#wallets)
  - [Transfers](#transfers)
  - [Holds](#holds)
  - [Platforms](#platforms)
- [Data Schema](#data-schema)
- [Concurrency & Consistency](#concurrency--consistency)
- [Background Jobs](#background-jobs)

---

## Overview

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Platform** | A tenant (e.g., Kunfupay) that integrates with the wallet. Authenticated via API key. Each platform has isolated wallets. |
| **Wallet** | A balance container for a specific user, platform, and currency. One wallet per `(owner_id, platform_id, currency_code)` tuple. |
| **System Wallet** | Auto-created per platform+currency. Acts as the omnibus counterpart for deposits and withdrawals (double-entry). |
| **Transaction** | An immutable record of a single wallet's movement (deposit, withdrawal, transfer_in, transfer_out, hold_capture). |
| **Movement** | Groups all transactions and ledger entries for one financial operation. A transfer creates 2 transactions under 1 movement. |
| **Ledger Entry** | Double-entry bookkeeping record. Every movement creates balanced CREDIT/DEBIT entries. Append-only and immutable (enforced by DB trigger). |
| **Hold** | Reserves funds without transferring them. Reduces available balance. Can be captured (converted to withdrawal) or voided (released). |

### Key Guarantees

- **Double-entry accounting**: Every movement produces balanced ledger entries that sum to zero.
- **Immutable ledger**: Ledger entries cannot be updated or deleted (enforced by PostgreSQL trigger + revoked permissions).
- **Idempotency**: All financial mutations accept an `idempotency-key` header. Replaying the same request returns the cached response.
- **Optimistic locking**: Concurrent writes to the same wallet are detected via version counter and retried automatically (up to 3 times).
- **Serializable isolation**: All transactional operations run under PostgreSQL's serializable isolation level.
- **Non-negative balance**: Wallet balances cannot go below zero (enforced by DB CHECK constraint). System wallets are exempt.

### Base URL

```
/v1
```

Additional utility routes:

| Path | Description |
|------|-------------|
| `GET /health` | Health check — returns `{ "status": "ok" }` |
| `GET /openapi` | OpenAPI 3.x spec (auto-generated) |
| `GET /docs` | Interactive API docs (Scalar UI) |

---

## Authentication

All endpoints (except `GET /v1/platforms` and health/docs) require API key authentication.

**Header:** `x-api-key`
**Format:** `<api_key_id>.<secret>`

The API key ID is a public identifier. The secret is hashed (SHA-256) and compared in constant time against the stored hash. The platform must have `status: "active"`.

**Error responses:**

| Code | Status | When |
|------|--------|------|
| `MISSING_API_KEY` | 401 | Header not provided |
| `INVALID_API_KEY` | 401 | Key not found, wrong secret, or platform not active |

---

## Idempotency

All financial mutations (POST endpoints that create wallets, deposits, withdrawals, transfers, holds, or captures) require an idempotency key.

**Header:** `idempotency-key` (required)

### Behavior

1. **First request**: Executes normally. Response is cached for 48 hours.
2. **Replay (same key + same body)**: Returns cached response immediately without re-executing.
3. **Payload mismatch (same key + different body)**: Returns `422 IDEMPOTENCY_PAYLOAD_MISMATCH`.
4. **Concurrent duplicate (same key while first still processing)**: Returns `409 IDEMPOTENCY_KEY_IN_PROGRESS`.

### Transient vs Deterministic Errors

- **5xx errors and 409 VERSION_CONFLICT**: The idempotency record is **released** so the client can retry with the same key.
- **2xx and 4xx (validation/domain)**: The response is **cached** and replayed on retry.

### Error responses

| Code | Status | When |
|------|--------|------|
| `MISSING_IDEMPOTENCY_KEY` | 400 | Header not provided on a mutating request |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Another request with this key is still processing |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` | 422 | Same key was used with a different request body |

### Endpoints that require idempotency

| Endpoint | Idempotency Required |
|----------|---------------------|
| `POST /v1/wallets` | Yes |
| `POST /v1/wallets/:walletId/deposit` | Yes |
| `POST /v1/wallets/:walletId/withdraw` | Yes |
| `POST /v1/wallets/:walletId/freeze` | No |
| `POST /v1/wallets/:walletId/unfreeze` | No |
| `POST /v1/wallets/:walletId/close` | No |
| `POST /v1/transfers` | Yes |
| `POST /v1/holds` | Yes |
| `POST /v1/holds/:holdId/capture` | Yes |
| `POST /v1/holds/:holdId/void` | No |

---

## Error Handling

All errors follow a consistent JSON format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

### Error Code Reference

#### Authentication (401)

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | `x-api-key` header not provided |
| `INVALID_API_KEY` | API key not found, wrong secret, or platform inactive |

#### Validation (400)

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Generic validation error (bad filter, sort, cursor, etc.) |
| `INVALID_CURRENCY` | `currency_code` is not 3 uppercase letters |
| `INVALID_AMOUNT` | `amount_cents` is not a positive integer |
| `SAME_WALLET` | Source and target wallet are the same in a transfer |
| `HOLD_EXPIRES_IN_PAST` | `expires_at` is not a future timestamp |
| `MISSING_IDEMPOTENCY_KEY` | Idempotency header missing on a mutating request |

#### Not Found (404)

| Code | Description |
|------|-------------|
| `WALLET_NOT_FOUND` | Wallet does not exist or belongs to a different platform |
| `HOLD_NOT_FOUND` | Hold does not exist or belongs to a different platform |

#### Conflict (409)

| Code | Description |
|------|-------------|
| `WALLET_ALREADY_EXISTS` | A wallet already exists for this `(owner_id, platform_id, currency_code)` |
| `VERSION_CONFLICT` | Concurrent modification detected — retry the request |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | Another request with this idempotency key is still processing |

#### Domain Rules (422)

| Code | Description |
|------|-------------|
| `WALLET_NOT_ACTIVE` | Operation requires an active wallet, but it is frozen or closed |
| `WALLET_CLOSED` | Wallet is permanently closed |
| `WALLET_ALREADY_FROZEN` | Wallet is already frozen |
| `WALLET_NOT_FROZEN` | Cannot unfreeze a wallet that is not frozen |
| `WALLET_BALANCE_NOT_ZERO` | Cannot close wallet — balance must be zero |
| `WALLET_HAS_ACTIVE_HOLDS` | Cannot close wallet — active holds exist |
| `CANNOT_FREEZE_SYSTEM_WALLET` | System wallets cannot be frozen |
| `CANNOT_CLOSE_SYSTEM_WALLET` | System wallets cannot be closed |
| `INSUFFICIENT_FUNDS` | Not enough balance for withdrawal/transfer |
| `INSUFFICIENT_AVAILABLE_BALANCE` | Not enough available balance (balance minus active holds) for a hold |
| `CURRENCY_MISMATCH` | Source and target wallets have different currencies |
| `HOLD_NOT_ACTIVE` | Hold has already been captured, voided, or expired |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` | Same idempotency key used with a different request body |

#### Internal (500)

| Code | Description |
|------|-------------|
| `SYSTEM_WALLET_NOT_FOUND` | System wallet missing — data integrity issue |
| `INTERNAL_ERROR` | Unhandled exception |

---

## Pagination & Filtering

All list endpoints (`GET /v1/wallets/:id/transactions`, `GET /v1/wallets/:id/ledger`, `GET /v1/platforms`) support Stripe-style query parameters for filtering, sorting, and keyset cursor pagination.

### Pagination

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 50 | Page size (1–100) |
| `cursor` | string | — | Opaque cursor from `next_cursor` of a previous response |

Responses include `next_cursor: string | null`. Pass it as `?cursor=...` to fetch the next page. When `null`, there are no more results.

### Sorting

**Parameter:** `sort`
**Format:** Comma-separated fields. Prefix with `-` for descending.

```
?sort=-created_at,amount_cents    → created_at DESC, amount_cents ASC
?sort=type                        → type ASC
```

An `id` tiebreaker is appended automatically for deterministic ordering.

### Filtering

**Shorthand (equality):**

```
?filter[type]=deposit
```

**Explicit operator:**

```
?filter[amount_cents][gte]=1000
?filter[created_at][lt]=1711929600000
```

**Multiple values (in):**

```
?filter[type]=deposit,withdrawal
```

**JSON path filtering (metadata):**

```
?filter[metadata.source]=settlement
?filter[metadata.source]=settlement&filter[metadata.referenceId]=abc123
?filter[metadata.nested.key]=value
```

Metadata JSON paths support up to 3 levels of depth. Path segments must be alphanumeric or underscores.

### Available operators

| Operator | Description |
|----------|-------------|
| `eq` | Equals (default for shorthand) |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `in` | In set (comma-separated) |

---

## Endpoints

### Health Check

#### `GET /health`

Returns `{ "status": "ok" }`. No authentication required.

---

### Wallets

#### `POST /v1/wallets`

Create a new wallet for a user.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

A system wallet is auto-created alongside the first user wallet for each platform+currency combination.

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `owner_id` | string | Yes | 1–255 characters. Your external user identifier. |
| `currency_code` | string | Yes | Exactly 3 uppercase letters (ISO 4217, e.g., `EUR`) |

**Response:**

```json
{
  "wallet_id": "01J..."
}
```

**Errors:** `INVALID_CURRENCY`, `WALLET_ALREADY_EXISTS`

---

#### `GET /v1/wallets/:walletId`

Retrieve wallet details including balance and available balance.

**Auth:** Required | **Status:** `200`

**Response:**

```json
{
  "id": "01J...",
  "owner_id": "user_42",
  "platform_id": "01J...",
  "currency_code": "EUR",
  "balance_cents": 150000,
  "available_balance_cents": 130000,
  "status": "active",
  "is_system": false,
  "created_at": 1711929600000,
  "updated_at": 1711929600000
}
```

`available_balance_cents` = `balance_cents` minus the sum of all active holds.

**Errors:** `WALLET_NOT_FOUND`

---

#### `POST /v1/wallets/:walletId/deposit`

Add funds to a wallet.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

Creates a double-entry movement: CREDIT on the user wallet, DEBIT on the system wallet.

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `amount_cents` | integer | Yes | Positive integer |
| `reference` | string | No | Max 500 characters. External reference (e.g., `"order-123"`) |

**Response:**

```json
{
  "transaction_id": "01J...",
  "movement_id": "01J..."
}
```

**Errors:** `INVALID_AMOUNT`, `WALLET_NOT_FOUND`, `WALLET_NOT_ACTIVE`

---

#### `POST /v1/wallets/:walletId/withdraw`

Remove funds from a wallet.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

Validates that `available_balance_cents >= amount_cents` before proceeding.

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `amount_cents` | integer | Yes | Positive integer |
| `reference` | string | No | Max 500 characters |

**Response:**

```json
{
  "transaction_id": "01J...",
  "movement_id": "01J..."
}
```

**Errors:** `INVALID_AMOUNT`, `WALLET_NOT_FOUND`, `WALLET_NOT_ACTIVE`, `INSUFFICIENT_FUNDS`

---

#### `POST /v1/wallets/:walletId/freeze`

Freeze a wallet. All financial operations (deposit, withdraw, transfer, hold) are rejected while frozen.

**Auth:** Required | **Idempotency:** Not required | **Status:** `200`

**Response:**

```json
{
  "status": "frozen"
}
```

**Errors:** `WALLET_NOT_FOUND`, `CANNOT_FREEZE_SYSTEM_WALLET`, `WALLET_ALREADY_FROZEN`, `WALLET_CLOSED`

---

#### `POST /v1/wallets/:walletId/unfreeze`

Unfreeze a frozen wallet, restoring it to active status.

**Auth:** Required | **Idempotency:** Not required | **Status:** `200`

**Response:**

```json
{
  "status": "active"
}
```

**Errors:** `WALLET_NOT_FOUND`, `WALLET_NOT_FROZEN`

---

#### `POST /v1/wallets/:walletId/close`

Permanently close a wallet. This action is irreversible.

**Auth:** Required | **Idempotency:** Not required | **Status:** `200`

**Preconditions:**
- Balance must be exactly zero
- No active holds may exist
- Cannot be a system wallet

**Response:**

```json
{
  "status": "closed"
}
```

**Errors:** `WALLET_NOT_FOUND`, `CANNOT_CLOSE_SYSTEM_WALLET`, `WALLET_BALANCE_NOT_ZERO`, `WALLET_HAS_ACTIVE_HOLDS`

---

#### `GET /v1/wallets/:walletId/transactions`

List transactions for a wallet with filtering, sorting, and pagination.

**Auth:** Required | **Status:** `200`

**Filterable fields:**

| Field | Type | Operators |
|-------|------|-----------|
| `type` | enum: `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `hold_capture` | `eq`, `in` |
| `status` | enum: `completed`, `failed`, `reversed` | `eq`, `in` |
| `amount_cents` | bigint | `eq`, `gt`, `gte`, `lt`, `lte` |
| `created_at` | bigint (Unix ms) | `gt`, `gte`, `lt`, `lte` |
| `counterpart_wallet_id` | string | `eq` |
| `reference` | string | `eq` |
| `metadata.*` | JSON path (max depth 3) | `eq` (implicit) |

**Sortable fields:** `created_at` (default: desc), `amount_cents`, `type`

**Response:**

```json
{
  "transactions": [
    {
      "id": "01J...",
      "wallet_id": "01J...",
      "counterpart_wallet_id": "01J..." | null,
      "type": "deposit",
      "amount_cents": 10000,
      "status": "completed",
      "idempotency_key": "idem-abc-123" | null,
      "reference": "order-123" | null,
      "metadata": { "source": "settlement" } | null,
      "hold_id": null,
      "created_at": 1711929600000
    }
  ],
  "next_cursor": "eyJ2Ij..." | null
}
```

**Errors:** `WALLET_NOT_FOUND`, `INVALID_REQUEST`

---

#### `GET /v1/wallets/:walletId/ledger`

List double-entry ledger entries for a wallet.

**Auth:** Required | **Status:** `200`

**Filterable fields:**

| Field | Type | Operators |
|-------|------|-----------|
| `entry_type` | enum: `CREDIT`, `DEBIT` | `eq`, `in` |
| `amount_cents` | bigint | `eq`, `gt`, `gte`, `lt`, `lte` |
| `created_at` | bigint (Unix ms) | `gt`, `gte`, `lt`, `lte` |
| `transaction_id` | string | `eq` |

**Sortable fields:** `created_at` (default: desc), `amount_cents`, `balance_after_cents`

**Response:**

```json
{
  "ledger_entries": [
    {
      "id": "01J...",
      "transaction_id": "01J...",
      "wallet_id": "01J...",
      "entry_type": "CREDIT",
      "amount_cents": 10000,
      "balance_after_cents": 150000,
      "created_at": 1711929600000
    }
  ],
  "next_cursor": "eyJ2Ij..." | null
}
```

**Errors:** `WALLET_NOT_FOUND`, `INVALID_REQUEST`

---

### Transfers

#### `POST /v1/transfers`

Transfer funds between two wallets atomically.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

Both wallets must belong to the same platform and have the same currency. Creates two transactions (transfer_out + transfer_in) under one movement. Wallets are locked in deterministic order (by ID) to prevent deadlocks.

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `source_wallet_id` | string | Yes | 1–255 characters |
| `target_wallet_id` | string | Yes | 1–255 characters, must differ from source |
| `amount_cents` | integer | Yes | Positive integer |
| `reference` | string | No | Max 500 characters |

**Response:**

```json
{
  "source_transaction_id": "01J...",
  "target_transaction_id": "01J...",
  "movement_id": "01J..."
}
```

**Errors:** `INVALID_AMOUNT`, `SAME_WALLET`, `WALLET_NOT_FOUND`, `WALLET_NOT_ACTIVE`, `INSUFFICIENT_FUNDS`, `CURRENCY_MISMATCH`

---

### Holds

Holds reserve funds without transferring them. The available balance decreases by the hold amount, but the actual balance remains unchanged until the hold is captured.

#### `POST /v1/holds`

Place an authorization hold on a wallet.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `wallet_id` | string | Yes | 1–255 characters |
| `amount_cents` | integer | Yes | Positive integer |
| `reference` | string | No | Max 500 characters |
| `expires_at` | integer | No | Unix timestamp in ms. Must be in the future. Hold auto-expires after this time. |

**Response:**

```json
{
  "hold_id": "01J..."
}
```

**Errors:** `INVALID_AMOUNT`, `HOLD_EXPIRES_IN_PAST`, `WALLET_NOT_FOUND`, `WALLET_NOT_ACTIVE`, `INSUFFICIENT_AVAILABLE_BALANCE`

---

#### `POST /v1/holds/:holdId/capture`

Capture (complete) an active hold. Converts the held amount into a withdrawal transaction.

**Auth:** Required | **Idempotency:** Required | **Status:** `201`

Creates a `hold_capture` transaction and corresponding ledger entries. The hold status changes to `captured`.

**Response:**

```json
{
  "transaction_id": "01J...",
  "movement_id": "01J..."
}
```

**Errors:** `HOLD_NOT_FOUND`, `HOLD_NOT_ACTIVE`

---

#### `POST /v1/holds/:holdId/void`

Void (cancel) an active hold. The reserved funds are released back to available balance.

**Auth:** Required | **Idempotency:** Not required | **Status:** `200`

No transaction or ledger entry is created — the hold is simply marked as voided.

**Response:**

```json
{
  "status": "voided"
}
```

**Errors:** `HOLD_NOT_FOUND`, `HOLD_NOT_ACTIVE`

---

#### `GET /v1/holds/:holdId`

Retrieve hold details.

**Auth:** Required | **Status:** `200`

**Response:**

```json
{
  "id": "01J...",
  "wallet_id": "01J...",
  "amount_cents": 20000,
  "status": "active",
  "reference": "payout:01J..." | null,
  "expires_at": 1711929600000 | null,
  "created_at": 1711929600000,
  "updated_at": 1711929600000
}
```

**Errors:** `HOLD_NOT_FOUND`

---

#### `GET /v1/holds/wallet/:walletId`

List holds for a wallet with filtering, sorting, and pagination.

**Auth:** Required | **Status:** `200`

**Filterable fields:**

| Field | Type | Operators |
|-------|------|-----------|
| `status` | enum: `active`, `captured`, `voided`, `expired` | `eq`, `in` |
| `amount_cents` | bigint | `eq`, `gt`, `gte`, `lt`, `lte` |
| `created_at` | bigint (Unix ms) | `gt`, `gte`, `lt`, `lte` |
| `reference` | string | `eq` |

**Sortable fields:** `created_at` (default: desc), `amount_cents`

**Response:**

```json
{
  "holds": [
    {
      "id": "01J...",
      "wallet_id": "01J...",
      "amount_cents": 20000,
      "status": "active",
      "reference": "payout:01J..." | null,
      "expires_at": 1711929600000 | null,
      "created_at": 1711929600000,
      "updated_at": 1711929600000
    }
  ],
  "next_cursor": "eyJ2Ij..." | null
}
```

**Errors:** `WALLET_NOT_FOUND`, `INVALID_REQUEST`

---

### Platforms

#### `GET /v1/platforms`

List registered platforms. Public endpoint — no authentication required.

**Filterable fields:**

| Field | Type | Operators |
|-------|------|-----------|
| `status` | enum: `active`, `suspended`, `revoked` | `eq`, `in` |
| `created_at` | bigint (Unix ms) | `gt`, `gte`, `lt`, `lte` |

**Sortable fields:** `created_at` (default: desc), `name`

**Response:**

```json
{
  "platforms": [
    {
      "id": "01J...",
      "name": "Kunfupay",
      "status": "active",
      "created_at": 1711929600000,
      "updated_at": 1711929600000
    }
  ],
  "next_cursor": "eyJ2Ij..." | null
}
```

---

## Data Schema

### Entity Relationship

```
Platform 1──* Wallet 1──* Transaction *──1 Movement
                │                │
                │                └──* LedgerEntry
                │
                └──* Hold
```

A platform has many wallets. Each wallet has many transactions and holds. Transactions belong to a movement. Each transaction produces ledger entries.

### Wallet

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `owner_id` | string (1–255) | External user identifier provided by the platform |
| `platform_id` | UUID v7 | FK to Platform |
| `currency_code` | string (3) | ISO 4217 currency code (e.g., `EUR`, `USD`) |
| `cached_balance_cents` | bigint | Current total balance in smallest currency unit (cents) |
| `status` | enum | `active` · `frozen` · `closed` |
| `version` | integer | Optimistic locking counter, starts at 1 |
| `is_system` | boolean | `true` for omnibus system wallets |
| `created_at` | bigint | Unix milliseconds |
| `updated_at` | bigint | Unix milliseconds |

**Unique constraint:** `(owner_id, platform_id, currency_code)`
**CHECK:** `cached_balance_cents >= 0` (system wallets exempt)

### Transaction

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `wallet_id` | UUID v7 | FK to Wallet |
| `counterpart_wallet_id` | UUID v7 · null | The other wallet in a transfer or the system wallet in deposit/withdrawal |
| `type` | enum | `deposit` · `withdrawal` · `transfer_in` · `transfer_out` · `hold_capture` |
| `amount_cents` | bigint | Always positive |
| `status` | enum | `completed` · `failed` · `reversed` |
| `idempotency_key` | string · null | Unique. Used for deduplication. |
| `reference` | string · null | External reference (e.g., order ID) |
| `metadata` | JSON · null | Arbitrary key-value data attached by the caller |
| `hold_id` | UUID v7 · null | FK to Hold (for `hold_capture` transactions) |
| `movement_id` | UUID v7 | FK to Movement |
| `created_at` | bigint | Unix milliseconds |

**CHECK:** `amount_cents > 0`

### Ledger Entry

Double-entry bookkeeping. Every financial operation creates balanced entries. **Append-only — cannot be updated or deleted.**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `transaction_id` | UUID v7 | FK to Transaction |
| `wallet_id` | UUID v7 | FK to Wallet |
| `entry_type` | enum | `CREDIT` (funds in) · `DEBIT` (funds out) |
| `amount_cents` | bigint | Positive for CREDIT, negative for DEBIT |
| `balance_after_cents` | bigint | Balance snapshot after this entry |
| `movement_id` | UUID v7 | FK to Movement |
| `created_at` | bigint | Unix milliseconds |

**Immutability enforced by:**
- PostgreSQL trigger `ledger_entries_immutable` (prevents UPDATE and DELETE)
- Revoked UPDATE/DELETE permissions at the database level

### Movement

Groups all transactions and ledger entries for a single financial operation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `type` | enum | `deposit` · `withdrawal` · `transfer` · `hold_capture` |
| `created_at` | bigint | Unix milliseconds |

### Hold

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `wallet_id` | UUID v7 | FK to Wallet |
| `amount_cents` | bigint | Always positive |
| `status` | enum | `active` · `captured` · `voided` · `expired` |
| `reference` | string · null | External reference |
| `expires_at` | bigint · null | Unix ms. If set, hold auto-expires after this time. |
| `created_at` | bigint | Unix milliseconds |
| `updated_at` | bigint | Unix milliseconds |

**CHECK:** `amount_cents > 0`

### Platform

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `name` | string | Display name |
| `api_key_id` | string | Public API key identifier (unique) |
| `api_key_hash` | string | SHA-256 hash of the API key secret |
| `status` | enum | `active` · `suspended` · `revoked` |
| `created_at` | bigint | Unix milliseconds |
| `updated_at` | bigint | Unix milliseconds |

### Idempotency Record

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID v7 | Primary key |
| `idempotency_key` | string | Unique per platform |
| `platform_id` | UUID v7 | FK to Platform |
| `request_hash` | string | SHA-256 of `method:path:body` |
| `response_status` | integer | Cached HTTP status (0 = pending) |
| `response_body` | JSON | Cached response body |
| `created_at` | bigint | Unix milliseconds |
| `expires_at` | bigint | Unix ms. TTL = 48 hours. |

---

## Concurrency & Consistency

### Optimistic Locking

Every wallet has a `version` counter. When a write operation modifies a wallet, it increments the version and includes the current version in the UPDATE WHERE clause. If another transaction modified the wallet first, the WHERE matches zero rows and the operation is retried.

- **Max retries:** 3
- **Backoff:** Exponential (30ms, 60ms, 120ms)
- **On exhaustion:** Returns `409 VERSION_CONFLICT` to the client

### Serializable Isolation

All financial operations execute within PostgreSQL transactions at `SERIALIZABLE` isolation level. This prevents all anomalies (dirty reads, non-repeatable reads, phantom reads, write skew).

### Deadlock Prevention

Transfers acquire wallet locks in deterministic order (lower wallet ID first). This prevents A→B / B→A deadlock cycles.

### Available Balance Calculation

```
available_balance = cached_balance_cents - sum(active holds amount_cents)
```

Holds reduce available balance without affecting the actual balance. When a hold is captured, the actual balance decreases. When voided or expired, the available balance is restored.

---

## Background Jobs

### Expire Holds

- **Interval:** Every 30 seconds
- **Action:** Finds all holds where `status = active` AND `expires_at <= now()` and marks them as `expired`
- **Effect:** Available balance is automatically restored (no transaction created)

### Cleanup Idempotency Records

- **Interval:** Periodic
- **Action:** Deletes idempotency records where `expires_at < now()` (older than 48 hours)

---

## Operation Flows

### Deposit Flow

```
Client → POST /v1/wallets/:id/deposit { amount_cents: 10000 }
  1. Validate wallet exists and is active
  2. Load system wallet for this platform+currency
  3. BEGIN TRANSACTION (serializable)
  4. Create Movement (type: "deposit")
  5. Increment wallet.cached_balance_cents by amount
  6. Create Transaction (type: "deposit") on user wallet
  7. Create LedgerEntry CREDIT +10000 on user wallet
  8. Create LedgerEntry DEBIT -10000 on system wallet
  9. COMMIT
  → Response: { transaction_id, movement_id }
```

### Transfer Flow

```
Client → POST /v1/transfers { source_wallet_id, target_wallet_id, amount_cents: 5000 }
  1. Validate both wallets exist, active, same platform, same currency
  2. Check source available_balance >= amount
  3. BEGIN TRANSACTION (serializable)
  4. Create Movement (type: "transfer")
  5. Decrement source.cached_balance_cents
  6. Increment target.cached_balance_cents
  7. Create Transaction (type: "transfer_out") on source
  8. Create Transaction (type: "transfer_in") on target
  9. Create LedgerEntry DEBIT on source
  10. Create LedgerEntry CREDIT on target
  11. Save wallets in ID order (deadlock prevention)
  12. COMMIT
  → Response: { source_transaction_id, target_transaction_id, movement_id }
```

### Hold → Capture Flow

```
Client → POST /v1/holds { wallet_id, amount_cents: 2000 }
  1. Validate wallet active, available_balance >= amount
  2. Create Hold (status: "active")
  3. available_balance is now reduced by 2000
  → Response: { hold_id }

Client → POST /v1/holds/:holdId/capture
  1. Validate hold exists and is active
  2. BEGIN TRANSACTION (serializable)
  3. Create Movement (type: "hold_capture")
  4. Decrement wallet.cached_balance_cents by hold amount
  5. Mark hold as "captured"
  6. Create Transaction (type: "hold_capture", hold_id: ...)
  7. Create LedgerEntry DEBIT on user wallet
  8. Create LedgerEntry CREDIT on system wallet
  9. COMMIT
  → Response: { transaction_id, movement_id }
```
