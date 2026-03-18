# Wallets API

## POST /v1/wallets

Create a new wallet.

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Request Body
```json
{
  "owner_id": "user-123",
  "currency_code": "USD"
}
```

### Response 201
```json
{ "wallet_id": "01912..." }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_ALREADY_EXISTS | 409 | Wallet exists for this owner/platform/currency |
| INVALID_REQUEST | 400 | Invalid body |

### Example
```bash
curl -X POST http://localhost:3000/v1/wallets \
  -H "X-API-Key: key_id.secret" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"owner_id":"user-123","currency_code":"USD"}'
```

---

## GET /v1/wallets/:walletId

Get wallet details including available balance.

### Headers
- `X-API-Key` (required)

### Response 200
```json
{
  "id": "01912...",
  "owner_id": "user-123",
  "platform_id": "plat-1",
  "currency_code": "USD",
  "balance_cents": 10000,
  "available_balance_cents": 8000,
  "status": "active",
  "is_system": false,
  "created_at": 1710700000000,
  "updated_at": 1710700000000
}
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |

---

## POST /v1/wallets/:walletId/deposit

Deposit funds into a wallet.

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Request Body
```json
{
  "amount_cents": 5000,
  "reference": "order-456"
}
```

### Response 201
```json
{ "transaction_id": "01912..." }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |
| WALLET_NOT_ACTIVE | 422 | Wallet is frozen or closed |
| INVALID_AMOUNT | 400 | Amount not positive |

---

## POST /v1/wallets/:walletId/withdraw

Withdraw funds from a wallet.

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Request Body
```json
{
  "amount_cents": 3000,
  "reference": "payout-789"
}
```

### Response 201
```json
{ "transaction_id": "01912..." }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |
| WALLET_NOT_ACTIVE | 422 | Wallet is frozen or closed |
| INSUFFICIENT_FUNDS | 422 | Insufficient available balance |
| INVALID_AMOUNT | 400 | Amount not positive |

---

## POST /v1/wallets/:walletId/freeze

Freeze a wallet.

### Headers
- `X-API-Key` (required)

### Response 200
```json
{ "status": "frozen" }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |
| CANNOT_FREEZE_SYSTEM_WALLET | 422 | System wallets cannot be frozen |
| WALLET_CLOSED | 422 | Wallet is closed |

---

## POST /v1/wallets/:walletId/close

Close a wallet (irreversible).

### Headers
- `X-API-Key` (required)

### Response 200
```json
{ "status": "closed" }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |
| WALLET_BALANCE_NOT_ZERO | 422 | Balance must be zero |
| WALLET_HAS_ACTIVE_HOLDS | 422 | Active holds must be resolved |

---

## GET /v1/wallets/:walletId/transactions

List transactions for a wallet (cursor-based pagination).

### Headers
- `X-API-Key` (required)

### Query Parameters
- `limit` (optional, default 50, max 100)
- `cursor` (optional, transaction ID for next page)

### Response 200
```json
{
  "transactions": [
    {
      "id": "01912...",
      "wallet_id": "...",
      "counterpart_wallet_id": "...",
      "type": "deposit",
      "amount_cents": 5000,
      "status": "completed",
      "idempotency_key": "...",
      "reference": "order-456",
      "metadata": null,
      "hold_id": null,
      "created_at": 1710700000000
    }
  ],
  "next_cursor": "01912..."
}
```

---

## GET /v1/wallets/:walletId/ledger

List ledger entries for a wallet (cursor-based pagination).

### Headers
- `X-API-Key` (required)

### Query Parameters
- `limit` (optional, default 50, max 100)
- `cursor` (optional, ledger entry ID for next page)

### Response 200
```json
{
  "ledger_entries": [
    {
      "id": "01912...",
      "transaction_id": "...",
      "wallet_id": "...",
      "entry_type": "CREDIT",
      "amount_cents": 5000,
      "balance_after_cents": 15000,
      "created_at": 1710700000000
    }
  ],
  "next_cursor": "01912..."
}
```
