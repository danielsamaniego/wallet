# Holds API

## POST /v1/holds

Place a hold (authorization) on a wallet.

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Request Body
```json
{
  "wallet_id": "01912...",
  "amount_cents": 3000,
  "reference": "auth-001",
  "expires_at": 1710786400000
}
```

### Response 201
```json
{ "hold_id": "01916..." }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Wallet not found |
| WALLET_NOT_ACTIVE | 422 | Wallet is not active |
| INSUFFICIENT_FUNDS | 422 | Insufficient available balance for hold |
| INVALID_AMOUNT | 400 | Amount not positive |

---

## POST /v1/holds/:holdId/capture

Capture a hold, converting it to a debit.

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Response 201
```json
{ "transaction_id": "01917..." }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| HOLD_NOT_FOUND | 404 | Hold not found or expired |
| HOLD_NOT_ACTIVE | 422 | Hold already captured or voided |

---

## POST /v1/holds/:holdId/void

Void a hold, releasing reserved funds.

### Headers
- `X-API-Key` (required)

### Response 200
```json
{ "status": "voided" }
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| HOLD_NOT_FOUND | 404 | Hold not found or expired |
| HOLD_NOT_ACTIVE | 422 | Hold already captured or voided |

### Example
```bash
curl -X POST http://localhost:3000/v1/holds \
  -H "X-API-Key: key_id.secret" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"wallet_id":"...","amount_cents":3000}'
```
