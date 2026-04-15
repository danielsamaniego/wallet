# Migration Guide — Monolith → Wallet Service

## Context

The marketplace monolith currently handles everything: balances, payouts, payins, card operations, and transfers in a single `balance_movements` table. The goal is to migrate **only the balance/ledger layer** to the new wallet service, while the monolith keeps owning the business workflows.

```
┌──────────────────────────────────────────────────────────────┐
│                     Monolith (keeps)                          │
│                                                               │
│  - Sales accumulation logic                                   │
│  - Monday settlement scheduler                                │
│  - Payout approval workflow (request → admin → approve/reject)│
│  - Virtual card management (load/unload)                      │
│  - Transfer rules and validation                              │
│  - Bank transfer integration                                  │
│  - User/admin UI                                              │
│                                                               │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTP (x-api-key + idempotency-key)
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                   Wallet Service (new)                        │
│                                                               │
│  - Balance storage (cached_balance_minor)                     │
│  - Double-entry immutable ledger                              │
│  - Holds (fund reservation)                                   │
│  - Deposits / Withdrawals / Transfers                         │
│  - Optimistic locking + serializable isolation                │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

The monolith talks to the wallet over HTTP. This means **no shared transactions** — every integration point needs its own consistency strategy.

---

## Principle: who is the source of truth for what

| Data | Source of truth | Why |
|---|---|---|
| User balance | Wallet service | That's its entire purpose |
| Ledger / movements | Wallet service | Immutable double-entry ledger |
| Payout requests (approval state) | Monolith | Business workflow, not a financial primitive |
| Card load/unload records | Monolith | Card management is its domain |
| Sales / orders | Monolith | Business data |
| Settlement schedule | Monolith | Business rule (Mondays) |
| Bank transfer state | Monolith | External integration |

The wallet doesn't know what a "payout", "card", or "settlement" is. It just sees deposits, withdrawals, holds, and transfers. The `reference` and `metadata` fields on each operation carry the business context from the monolith.

---

## Case 1: Payins (Monday settlement)

### Current flow

The monolith accumulates sales during the week. On Monday, a scheduler releases accumulated earnings as a single movement into the user's balance.

### Migration: simple, low risk

The monolith calls `POST /v1/wallets/:id/deposit` every Monday.

```
Monolith (Monday cron job)
  │
  │  For each user with accumulated sales:
  │
  ├─ 1. Calculate total_earnings for the week
  │
  ├─ 2. POST /v1/wallets/:walletId/deposit
  │     Headers:
  │       x-api-key: <platform_key>
  │       idempotency-key: settlement-{userId}-{weekISO}  ← e.g. "settlement-user42-2026-W13"
  │     Body:
  │       {
  │         "amount_minor": 150000,
  │         "reference": "settlement-2026-W13"
  │       }
  │
  ├─ 3. On success (201):
  │     → Mark settlement as completed in monolith
  │     → Store transaction_id and movement_id for auditing
  │
  ├─ 4. On failure:
  │     → Retry with same idempotency key (safe — wallet deduplicates)
  │     → After N retries: alert, manual resolution
  │
  └─ Done
```

### Consistency strategy

**Idempotency key is the entire safety net.** The key `settlement-{userId}-{weekISO}` ensures:
- If the monolith crashes after the deposit succeeds but before marking it complete → on restart, it retries → wallet returns the cached response → monolith marks complete
- If the deposit fails → monolith retries → wallet processes it fresh
- If the monolith runs twice for the same week → second call returns cached response

**Failure modes:**

| Scenario | Result | Resolution |
|---|---|---|
| Deposit succeeds, monolith marks complete | Happy path | — |
| Deposit succeeds, monolith crashes before marking | Retries on restart with same idempotency key → wallet returns cached | Automatic |
| Deposit fails (wallet down) | Monolith retries | Automatic |
| Deposit fails (WALLET_NOT_FOUND) | User doesn't have a wallet yet | Create wallet first, then deposit |
| Deposit fails (WALLET_NOT_ACTIVE) | Wallet is frozen/closed | Alert admin |

**Risk level: low.** Deposits are additive. The worst case is a delayed settlement, never a double-deposit (idempotency prevents it) or lost money.

---

## Case 2: Payouts (withdrawal with admin approval)

### Current flow

1. User requests withdrawal → monolith creates withdrawal record (pending)
2. Admin approves → monolith deducts from balance, initiates bank transfer
3. Admin rejects → monolith cancels withdrawal record, balance unchanged

### Migration: medium complexity

The monolith keeps the approval workflow. The wallet handles fund reservation via holds.

```
Monolith                                    Wallet Service
  │                                              │
  │  USER REQUESTS WITHDRAWAL                    │
  ├─ 1. Validate user, amount, bank account      │
  ├─ 2. POST /v1/holds ─────────────────────────►│ Reserve funds
  │     idempotency-key: payout-req-{payoutId}   │
  │     Body: {                                  │
  │       wallet_id, amount_minor,               │
  │       reference: "payout:{payoutId}"         │
  │     }                                        │
  │     ◄──────────────────────────── 201 ───────│ { hold_id }
  ├─ 3. INSERT payout_request                    │
  │     (status: pending, hold_id: "...")         │
  ├─ 4. Return payout_request_id to user         │
  │                                              │
  │  ADMIN APPROVES                              │
  ├─ 5. Validate payout is pending               │
  ├─ 6. POST /v1/holds/:holdId/capture ─────────►│ Withdraw funds
  │     idempotency-key: payout-apr-{payoutId}   │
  │     ◄──────────────────────────── 201 ───────│ { transaction_id, movement_id }
  ├─ 7. UPDATE payout_request                    │
  │     (status: approved, tx_id, reviewed_by)   │
  ├─ 8. Initiate bank transfer (async)           │
  │                                              │
  │  ADMIN REJECTS                               │
  ├─ 9. POST /v1/holds/:holdId/void ────────────►│ Release funds
  │     ◄──────────────────────────── 200 ───────│ { status: voided }
  ├─ 10. UPDATE payout_request                   │
  │      (status: rejected, reason, reviewed_by) │
  │                                              │
```

### Consistency strategy

Este es el caso más delicado. Hay tres puntos de fallo distribuido:

#### Fallo A: hold se crea pero payout_request no se guarda

```
1. POST /v1/holds → 201 (hold_id: "abc")
2. INSERT payout_request → 💥 DB error
→ Hold huérfano en wallet: fondos bloqueados sin razón
```

**Estrategia: saga con compensación + reconciliation job**

```typescript
// Monolith: RequestPayoutHandler

async requestPayout(userId, amount, bankAccountId) {
  const payoutId = generateId();

  // Step 1: reserve funds in wallet
  let holdId: string;
  try {
    const result = await this.walletClient.placeHold({
      walletId,
      amountMinor: amount,
      reference: `payout:${payoutId}`,
      idempotencyKey: `payout-req-${payoutId}`,
    });
    holdId = result.holdId;
  } catch (err) {
    // Wallet rejected (insufficient funds, wallet not active, etc.)
    // No state changed anywhere — safe to return error to user
    throw err;
  }

  // Step 2: persist payout request locally
  try {
    await this.payoutRepo.create({
      id: payoutId,
      userId,
      holdId,
      amountMinor: amount,
      bankAccountId,
      status: "pending",
    });
  } catch (err) {
    // Local persist failed — compensate by voiding the hold
    try {
      await this.walletClient.voidHold(holdId);
    } catch (compensationErr) {
      // Compensation also failed — log for reconciliation
      this.logger.error("ORPHANED_HOLD", { holdId, payoutId });
      // The reconciliation job will clean this up
    }
    throw err;
  }

  return { payoutId, holdId };
}
```

**Reconciliation job (runs every 5 minutes):**

```typescript
// Monolith: PayoutReconciliationJob

async reconcile() {
  // 1. Find orphaned holds: holds with reference "payout:*"
  //    that have no matching payout_request
  //
  //    Option A: wallet exposes GET /v1/holds?reference=payout:*&status=active
  //    Option B: monolith tracks attempted hold IDs in a staging table
  //
  //    If wallet doesn't support listing holds, use Option B:
  //    a staging table that records holdId BEFORE calling the wallet,
  //    and removes it AFTER the payout_request is persisted.

  const stagingRecords = await this.stagingRepo.findUnresolved(olderThan: 5min);
  for (const record of stagingRecords) {
    const payout = await this.payoutRepo.findByHoldId(record.holdId);
    if (!payout) {
      // Orphaned hold — void it
      await this.walletClient.voidHold(record.holdId);
      await this.stagingRepo.markResolved(record.id);
    }
  }

  // 2. Find pending payouts whose holds expired
  const pendingPayouts = await this.payoutRepo.findPending();
  for (const payout of pendingPayouts) {
    // Try to check hold status (if wallet exposes GET /v1/holds/:id)
    // or just attempt approval — if hold expired, capture will fail
  }
}
```

#### Fallo B: hold se captura pero payout_request no se actualiza a approved

```
1. POST /v1/holds/:id/capture → 201 (transaction_id: "xyz")
2. UPDATE payout_request SET status = approved → 💥 DB error
→ Money left wallet, but payout still says "pending"
→ Admin might try to approve again
```

**Estrategia: idempotency + retry**

```typescript
// Monolith: ApprovePayoutHandler

async approvePayout(payoutId, adminId) {
  const payout = await this.payoutRepo.findById(payoutId);
  if (payout.status !== "pending") throw new Error("NOT_PENDING");

  // Step 1: capture hold (idempotent)
  const result = await this.walletClient.captureHold(payout.holdId, {
    idempotencyKey: `payout-apr-${payoutId}`,
  });

  // Step 2: update local state
  // If this fails, admin retries → captureHold returns cached response → update succeeds
  await this.payoutRepo.update(payoutId, {
    status: "approved",
    transactionId: result.transactionId,
    reviewedBy: adminId,
    reviewedAt: Date.now(),
  });

  // Step 3: initiate bank transfer (async, separate concern)
  await this.bankTransferQueue.enqueue({ payoutId, amount: payout.amountMinor });
}
```

La idempotency key `payout-apr-{payoutId}` garantiza que reintentar es seguro. El wallet devuelve el mismo response cacheado, y el monolito actualiza el payout_request.

#### Fallo C: hold expira antes de que el admin actúe

```
Hold was created with expires_at.
Background job in wallet expires it.
Admin tries to approve → capture fails (HOLD_NOT_ACTIVE).
```

**Estrategia: catch and auto-reject**

```typescript
async approvePayout(payoutId, adminId) {
  const payout = await this.payoutRepo.findById(payoutId);

  try {
    const result = await this.walletClient.captureHold(payout.holdId, {
      idempotencyKey: `payout-apr-${payoutId}`,
    });
    // ... success path
  } catch (err) {
    if (err.code === "HOLD_NOT_ACTIVE" || err.code === "HOLD_EXPIRED") {
      // Auto-reject the payout
      await this.payoutRepo.update(payoutId, {
        status: "rejected",
        reason: "hold_expired",
        reviewedBy: "system",
        reviewedAt: Date.now(),
      });
      throw new PayoutHoldExpiredError(payoutId);
    }
    throw err;
  }
}
```

**Opcional: job proactivo** que revisa payouts pending cuyo hold podría haber expirado, y los auto-rechaza antes de que el admin intente.

#### Resumen de fallos payout

| Punto de fallo | Estrategia | Resolución |
|---|---|---|
| Hold creado, payout no guardado | Compensación (void hold) + reconciliation job | Automática |
| Hold capturado, payout no actualizado | Idempotency key + retry | Automática (admin reintenta) |
| Hold expirado antes de aprobación | Catch en approve + auto-reject | Automática |
| Void falla en rechazo | Retry + reconciliation job | Automática |

---

## Case 3: Card operations (load/unload virtual card)

### Current flow

- **Load card**: user moves money from wallet → virtual card
- **Unload card**: user moves money from virtual card → wallet

### Migration: simple

Desde la perspectiva del wallet, estas son operaciones primitivas:

| Card operation | Wallet operation | Why |
|---|---|---|
| Load card (wallet → card) | `POST /v1/wallets/:id/withdraw` | Money leaves the wallet |
| Unload card (card → wallet) | `POST /v1/wallets/:id/deposit` | Money enters the wallet |

```
Monolith                                    Wallet Service
  │                                              │
  │  LOAD CARD                                   │
  ├─ 1. Validate card, user, amount              │
  ├─ 2. POST /v1/wallets/:walletId/withdraw ────►│
  │     idempotency-key: card-load-{operationId} │
  │     Body: {                                  │
  │       amount_minor: 5000,                    │
  │       reference: "card-load:{cardId}"        │
  │     }                                        │
  │     ◄──────────────────────────── 201 ───────│
  ├─ 3. Credit virtual card balance locally      │
  ├─ 4. Record card_operation (completed)        │
  │                                              │
  │  UNLOAD CARD                                 │
  ├─ 1. Validate card has sufficient balance     │
  ├─ 2. Debit virtual card balance locally       │
  ├─ 3. POST /v1/wallets/:walletId/deposit ─────►│
  │     idempotency-key: card-unload-{opId}      │
  │     Body: {                                  │
  │       amount_minor: 3000,                    │
  │       reference: "card-unload:{cardId}"      │
  │     }                                        │
  │     ◄──────────────────────────── 201 ───────│
  ├─ 4. Record card_operation (completed)        │
  │                                              │
```

### Consistency strategy

#### Load card (wallet withdraw → card credit)

El orden importa: **primero retira del wallet, luego acredita la tarjeta.**

```typescript
async loadCard(userId, cardId, amount) {
  const operationId = generateId();

  // Step 1: withdraw from wallet (external call)
  const result = await this.walletClient.withdraw(walletId, {
    amountMinor: amount,
    reference: `card-load:${cardId}`,
    idempotencyKey: `card-load-${operationId}`,
  });

  // Step 2: credit card balance (local)
  try {
    await this.cardRepo.creditBalance(cardId, amount);
    await this.cardOperationRepo.create({
      id: operationId,
      type: "load",
      cardId,
      amount,
      walletTransactionId: result.transactionId,
      status: "completed",
    });
  } catch (err) {
    // Card credit failed — money left wallet but didn't arrive at card
    // Compensation: deposit back to wallet
    try {
      await this.walletClient.deposit(walletId, {
        amountMinor: amount,
        reference: `card-load-reversal:${operationId}`,
        idempotencyKey: `card-load-rev-${operationId}`,
      });
    } catch (compensationErr) {
      this.logger.error("CARD_LOAD_COMPENSATION_FAILED", { operationId, cardId });
      // Reconciliation job will fix this
    }
    throw err;
  }
}
```

**Why this order?** If you credit the card first and the wallet withdraw fails, the user has money on the card that wasn't backed by a real balance deduction. That's worse than the reverse (money left wallet but card not credited — you can compensate by depositing back).

#### Unload card (card debit → wallet deposit)

Orden inverso: **primero debita la tarjeta, luego deposita al wallet.**

```typescript
async unloadCard(userId, cardId, amount) {
  const operationId = generateId();

  // Step 1: debit card (local, reversible)
  await this.cardRepo.debitBalance(cardId, amount);

  // Step 2: deposit to wallet (external call)
  try {
    const result = await this.walletClient.deposit(walletId, {
      amountMinor: amount,
      reference: `card-unload:${cardId}`,
      idempotencyKey: `card-unload-${operationId}`,
    });
    await this.cardOperationRepo.create({
      id: operationId,
      type: "unload",
      cardId,
      amount,
      walletTransactionId: result.transactionId,
      status: "completed",
    });
  } catch (err) {
    // Wallet deposit failed — reverse card debit
    await this.cardRepo.creditBalance(cardId, amount);
    throw err;
  }
}
```

**Why this order?** If the wallet deposit fails, you still have the card balance — just reverse the debit locally. No money is lost.

#### Regla general para el orden

> **Primero la operación más difícil de revertir. Segundo la más fácil.**

| Operación | Más difícil de revertir | Más fácil |
|---|---|---|
| Load card | Wallet withdraw (external) | Card credit (local) |
| Unload card | Card debit (local) → compensable | Wallet deposit (external, additive) |

---

## Case 4: Transfers (P2P)

### Current flow

Users can transfer between their wallets.

### Migration: trivial

```
Monolith                                    Wallet Service
  │                                              │
  ├─ 1. Validate sender, receiver, amount        │
  ├─ 2. POST /v1/transfers ─────────────────────►│
  │     idempotency-key: transfer-{transferId}   │
  │     Body: {                                  │
  │       source_wallet_id,                      │
  │       target_wallet_id,                      │
  │       amount_minor: 10000,                   │
  │       reference: "p2p-transfer:{transferId}" │
  │     }                                        │
  │     ◄──────────────────────────── 201 ───────│
  ├─ 3. Record transfer locally (for UI/history) │
  │                                              │
```

### Consistency strategy

**Idempotency key is sufficient.** A transfer is a single atomic operation in the wallet — it either completes fully or not at all (same DB transaction for both wallets). The monolith just needs to record the result.

```typescript
async transfer(senderId, receiverId, amount) {
  const transferId = generateId();

  const result = await this.walletClient.transfer({
    sourceWalletId: senderWalletId,
    targetWalletId: receiverWalletId,
    amountMinor: amount,
    reference: `p2p:${transferId}`,
    idempotencyKey: `transfer-${transferId}`,
  });

  // Record locally (if this fails, retry — transfer is idempotent)
  await this.transferRepo.create({
    id: transferId,
    senderId,
    receiverId,
    amount,
    walletSourceTxId: result.sourceTransactionId,
    walletTargetTxId: result.targetTransactionId,
    status: "completed",
  });
}
```

Si el registro local falla: el transfer ya se ejecutó en el wallet. Al reintentar, la idempotency key devuelve el response cacheado. El monolito graba el registro. No hay inconsistencia.

---

## Summary: what the wallet needs vs what it already has

| Capability needed | Wallet status | Notes |
|---|---|---|
| Deposit (settlement, card unload) | ✅ Already exists | — |
| Withdraw (card load) | ✅ Already exists | — |
| Transfer (P2P) | ✅ Already exists | — |
| Place hold (payout fund reservation) | ✅ Already exists | — |
| Capture hold (payout approval) | ✅ Already exists | — |
| Void hold (payout rejection) | ✅ Already exists | — |
| List holds by reference | ❌ Not exposed | Needed for reconciliation job |
| Get hold by ID | ❌ Not exposed | Needed for hold expiry detection |

### Required wallet additions (minimal)

For the reconciliation job to work, the wallet should expose:

```
GET /v1/holds/:holdId
  Auth: required | Status: 200
  Response: { id, wallet_id, amount_minor, status, reference, expires_at, ... }

GET /v1/holds
  Auth: required | Status: 200
  Query: filter[wallet_id], filter[status], filter[reference], sort, limit, cursor
  Response: { holds: [...], next_cursor }
```

These are read-only queries — low risk to implement and essential for operational visibility.

---

## Idempotency key convention

Use a consistent naming scheme so keys are predictable and debuggable:

| Operation | Key format | Example |
|---|---|---|
| Settlement deposit | `settlement-{userId}-{weekISO}` | `settlement-user42-2026-W13` |
| Payout request (hold) | `payout-req-{payoutId}` | `payout-req-01J5K...` |
| Payout approval (capture) | `payout-apr-{payoutId}` | `payout-apr-01J5K...` |
| Card load (withdraw) | `card-load-{operationId}` | `card-load-01J5M...` |
| Card load reversal | `card-load-rev-{operationId}` | `card-load-rev-01J5M...` |
| Card unload (deposit) | `card-unload-{operationId}` | `card-unload-01J5N...` |
| P2P transfer | `transfer-{transferId}` | `transfer-01J5P...` |

---

## Migration sequence (recommended order)

### Phase 1: Wallet creation + Transfers (lowest risk)

1. Deploy wallet service
2. Create wallets for existing users (migration script: one wallet per user+currency)
3. Migrate P2P transfers to use wallet API
4. Run old and new in parallel, compare results (shadow mode)
5. Cut over transfers

### Phase 2: Payins / Settlements (low risk, additive)

1. Monday settlement job calls wallet deposit instead of local balance update
2. Idempotency keys make retries safe
3. Compare deposited totals vs old system

### Phase 3: Card operations (medium risk)

1. Card load → wallet withdraw + local card credit
2. Card unload → local card debit + wallet deposit
3. Compensation logic for failures

### Phase 4: Payouts (highest complexity)

1. Implement hold-based payout flow
2. Build reconciliation job
3. Test hold expiry handling
4. Migrate existing pending payouts (careful: in-flight requests need special handling)

### Phase 5: Decommission monolith balance

1. Stop writing to monolith `balance_movements` table
2. Wallet is single source of truth for balances
3. Keep monolith table read-only for historical reference
4. Eventually drop it

---

## Consistency cheat sheet

| Pattern | When to use | Cost |
|---|---|---|
| **Idempotency key** | Every mutation call | Free (wallet already supports it) |
| **Order of operations** | Card load/unload | Code discipline |
| **Saga + compensation** | Payout request creation | try/catch + void |
| **Reconciliation job** | Always (safety net) | Background worker + staging table |
| **Shadow mode** | During migration | Duplicate writes, comparison logic |

The golden rule: **idempotency keys handle 99% of failures.** Compensation + reconciliation handle the remaining 1%. Design for retry, not for perfection.
