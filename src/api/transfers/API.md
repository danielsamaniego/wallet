# Transfers API

## POST /v1/transfers

Transfer funds between two wallets (P2P).

### Headers
- `X-API-Key` (required)
- `Idempotency-Key` (required)

### Request Body
```json
{
  "source_wallet_id": "01912...",
  "target_wallet_id": "01913...",
  "amount_cents": 2000,
  "reference": "p2p-payment"
}
```

### Response 201
```json
{
  "source_transaction_id": "01914...",
  "target_transaction_id": "01915..."
}
```

### Errors
| Code | Status | Description |
|------|--------|-------------|
| WALLET_NOT_FOUND | 404 | Source or target wallet not found |
| WALLET_NOT_ACTIVE | 422 | Source or target wallet is not active |
| INSUFFICIENT_FUNDS | 422 | Source has insufficient available balance |
| CURRENCY_MISMATCH | 422 | Wallets must share the same currency |
| SAME_WALLET | 400 | Source and target must be different |
| INVALID_AMOUNT | 400 | Amount not positive |

### Example
```bash
curl -X POST http://localhost:3000/v1/transfers \
  -H "X-API-Key: key_id.secret" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"source_wallet_id":"...","target_wallet_id":"...","amount_cents":2000}'
```
