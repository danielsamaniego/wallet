# Withdrawal Approval Flow — Design Document

## Context

The current wallet is a financial engine: deposits, withdrawals, transfers, holds, and an immutable double-entry ledger. All operations are **immediate** — there is no concept of a pending operation that requires human review.

The marketplace needs a withdrawal flow where:

1. A user requests a withdrawal from their wallet
2. Funds are reserved so they can't spend them elsewhere
3. An admin reviews the request
4. On approval: the money leaves the wallet and the platform initiates a bank transfer
5. On rejection: the funds are released back to the user's available balance

This document analyzes three architectural approaches.

---

## Approach A — Wallet stays "dumb", orchestration in a separate service

### Philosophy

The wallet remains a generic balance engine. It knows nothing about approval workflows, admins, or reasons for rejection. A **separate service** (its own process, potentially its own database) owns the `PayoutRequest` lifecycle and orchestrates calls to the wallet API over HTTP.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Payout Service                     │
│  (separate process / deployment)                     │
│                                                      │
│  Entity: PayoutRequest                               │
│  ┌─────────────────────────────────────────────┐     │
│  │ id, wallet_id, amount, status, reason,      │     │
│  │ reviewed_by, reviewed_at, hold_id,          │     │
│  │ transaction_id, bank_account_id, ...        │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  Endpoints:                                          │
│  POST   /v1/payout-requests                          │
│  POST   /v1/payout-requests/:id/approve              │
│  POST   /v1/payout-requests/:id/reject               │
│  GET    /v1/payout-requests                          │
│                                                      │
└──────────────┬───────────────────────────────────────┘
               │ HTTP calls
               ▼
┌─────────────────────────────────────────────────────┐
│                   Wallet Service                     │
│  (unchanged — generic financial engine)              │
│                                                      │
│  POST /v1/holds           ← reserve funds            │
│  POST /v1/holds/:id/capture  ← confirm withdrawal    │
│  POST /v1/holds/:id/void     ← release funds         │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Flow

```
1. User requests withdrawal
   Payout Service:
     → Creates PayoutRequest(status: pending)
     → Calls Wallet: POST /v1/holds { wallet_id, amount_cents }
     → Stores hold_id on PayoutRequest
     → Returns payout_request_id to user

2. Admin approves
   Payout Service:
     → Validates PayoutRequest is pending
     → Calls Wallet: POST /v1/holds/:holdId/capture
     → Stores transaction_id on PayoutRequest
     → Updates PayoutRequest(status: approved, reviewed_by, reviewed_at)
     → Initiates bank transfer (async, separate concern)

3. Admin rejects
   Payout Service:
     → Validates PayoutRequest is pending
     → Calls Wallet: POST /v1/holds/:holdId/void
     → Updates PayoutRequest(status: rejected, reason, reviewed_by, reviewed_at)

4. Hold expires before admin acts
   Wallet Service:
     → Background job expires the hold automatically
   Payout Service:
     → Next time admin tries to approve → capture fails (HOLD_NOT_ACTIVE)
     → Payout Service catches error → auto-rejects PayoutRequest with reason "hold_expired"
     → OR: Payout Service runs its own periodic job that checks pending requests
       whose holds have expired, and auto-rejects them
```

### Wallet changes required

**None.** The wallet API already supports everything needed:

| Wallet operation | Purpose in this flow |
|---|---|
| `POST /v1/holds` | Reserve funds when user requests withdrawal |
| `POST /v1/holds/:id/capture` | Finalize withdrawal on admin approval |
| `POST /v1/holds/:id/void` | Release funds on admin rejection |
| `GET /v1/wallets/:id` | Check balance/status before operations |

### Payout Service domain model

```typescript
// Entity: PayoutRequest
{
  id: string;                    // UUIDv7
  wallet_id: string;             // Target wallet in wallet service
  platform_id: string;           // Tenant isolation
  amount_cents: bigint;          // Requested amount
  currency_code: string;         // For display/validation
  status: "pending" | "approved" | "rejected" | "expired";
  hold_id: string;               // From wallet service
  transaction_id: string | null; // From wallet service, after approval
  bank_account_id: string | null;// Where to send the money
  reason: string | null;         // Rejection reason
  reviewed_by: string | null;    // Admin identifier
  reviewed_at: number | null;    // Unix ms
  reference: string | null;      // External reference
  metadata: JSON | null;         // Arbitrary context
  created_at: number;            // Unix ms
  updated_at: number;            // Unix ms
}
```

Database: its own schema (could be same PostgreSQL instance, different schema, or entirely separate database).

### Failure handling

The critical concern is **consistency between the Payout Service and the Wallet Service**. Since they communicate via HTTP, we need to handle partial failures:

**Request creation fails after hold is placed:**
```
1. Payout Service calls POST /v1/holds → success (hold_id = "abc")
2. Payout Service tries to persist PayoutRequest → database error
3. Result: orphaned hold in wallet service
```

Mitigations:
- **Idempotency keys**: Retry the entire operation. The hold creation is idempotent, so replaying is safe.
- **Compensation job**: Periodically scan for holds with `reference: "payout:*"` that don't have a matching PayoutRequest, and void them.
- **Outbox pattern**: Write the PayoutRequest first, then process the hold creation asynchronously via an outbox table. More complex but guarantees consistency.

**Approval fails after hold is captured:**
```
1. Payout Service calls POST /v1/holds/:id/capture → success
2. Payout Service tries to update PayoutRequest(approved) → database error
3. Result: money left the wallet but PayoutRequest still says "pending"
```

Mitigations:
- **Idempotency keys**: The capture is idempotent. Retry the entire approval. On replay, the wallet returns the cached capture response. Then update the PayoutRequest.
- **Reconciliation job**: Periodically check pending PayoutRequests whose holds are captured, and reconcile them.

### Advantages

1. **Wallet stays generic and reusable.** Any future service (refunds, subscriptions, escrow) can use the same wallet without modification.
2. **Separation of concerns is real.** Financial engine vs. business workflow are genuinely separate domains. The wallet doesn't know what a "payout" is — it just moves money.
3. **Independent evolution.** You can change the approval flow (add multi-step approval, auto-approve below thresholds, add compliance checks) without touching the wallet.
4. **Battle-tested pattern.** This is how Stripe (Issuing + Treasury), Adyen, and most payment platforms structure their systems. The ledger/balance engine is always separate from business orchestration.
5. **Bank transfer integration lives naturally in the Payout Service**, not awkwardly bolted onto the wallet.

### Disadvantages

1. **Distributed consistency.** Two services, two databases, two sources of truth. Partial failures require compensation logic.
2. **More infrastructure.** A new service with its own database, API, deployment pipeline.
3. **Latency.** Each operation involves HTTP round-trips between services.
4. **Operational complexity.** Two services to monitor, debug, and deploy.
5. **Overkill for small teams.** If you have 2-3 developers and one wallet consumer, the overhead may not be worth it.

---

## Approach B — Withdrawal Request inside the wallet bounded context

### Philosophy

The wallet absorbs the withdrawal approval workflow. A new `WithdrawalRequest` entity lives in the wallet's domain layer, manages its own fund reservation (without depending on holds), and provides endpoints for the approval lifecycle.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Wallet Service                     │
│                                                      │
│  Existing entities:                                  │
│  Wallet, Transaction, Movement, LedgerEntry, Hold    │
│                                                      │
│  New entity: WithdrawalRequest                       │
│  ┌─────────────────────────────────────────────┐     │
│  │ id, wallet_id, amount_cents, status,        │     │
│  │ transaction_id, movement_id, reason,        │     │
│  │ reviewed_by, reviewed_at, reference,        │     │
│  │ metadata, created_at, updated_at            │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  New endpoints:                                      │
│  POST /v1/withdrawal-requests                        │
│  POST /v1/withdrawal-requests/:id/approve            │
│  POST /v1/withdrawal-requests/:id/reject             │
│  GET  /v1/withdrawal-requests                        │
│                                                      │
│  Modified behavior:                                  │
│  available_balance = cached_balance                   │
│                    - sum(active holds)                │
│                    - sum(pending withdrawal requests) │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Fund reservation: direct, not via holds

The `WithdrawalRequest` reserves funds **directly** by participating in the available balance calculation. No hold is created.

```
available_balance = cached_balance_cents
                  - sum(active holds amount_cents)
                  - sum(pending withdrawal_requests amount_cents)
```

This means:
- The `WithdrawalRequest` entity itself is the reservation mechanism
- No coupling to the Hold lifecycle (no expiration concerns, no accidental capture/void via hold endpoints)
- The wallet aggregate validates sufficient available balance at request creation time
- Concurrent requests are safe: optimistic locking on the wallet prevents double-spending

### Domain model

```typescript
// src/wallet/domain/withdrawalRequest/withdrawalRequest.entity.ts

type WithdrawalRequestStatus = "pending" | "approved" | "rejected";

class WithdrawalRequest {
  private _id: string;
  private _walletId: string;
  private _amountCents: bigint;
  private _status: WithdrawalRequestStatus;
  private _transactionId: string | null;   // set on approval
  private _movementId: string | null;      // set on approval
  private _reason: string | null;          // set on rejection
  private _reviewedBy: string | null;      // set on approval or rejection
  private _reviewedAt: number | null;      // set on approval or rejection
  private _reference: string | null;
  private _metadata: Record<string, unknown> | null;
  private _createdAt: number;
  private _updatedAt: number;

  static create(params: {
    id: string;
    walletId: string;
    amountCents: bigint;
    reference: string | null;
    metadata: Record<string, unknown> | null;
    now: number;
  }): WithdrawalRequest;

  static reconstruct(/* all fields */): WithdrawalRequest;

  approve(transactionId: string, movementId: string, reviewedBy: string, now: number): void {
    // Guard: must be pending
    // Sets status = "approved", transactionId, movementId, reviewedBy, reviewedAt
  }

  reject(reason: string, reviewedBy: string, now: number): void {
    // Guard: must be pending
    // Sets status = "rejected", reason, reviewedBy, reviewedAt
  }
}
```

### Database schema

```prisma
model WithdrawalRequest {
  id            String  @id
  walletId      String  @map("wallet_id")
  wallet        Wallet  @relation(fields: [walletId], references: [id])
  amountCents   BigInt  @map("amount_cents")
  status        String  @default("pending") /// pending | approved | rejected
  transactionId String? @unique @map("transaction_id")
  movementId    String? @map("movement_id")
  reason        String?
  reviewedBy    String? @map("reviewed_by")
  reviewedAt    BigInt? @map("reviewed_at")
  reference     String?
  metadata      Json?
  createdAt     BigInt  @map("created_at")
  updatedAt     BigInt  @map("updated_at")

  @@index([walletId, status])
  @@index([walletId, createdAt])
  @@index([status, createdAt])
  @@map("withdrawal_requests")
}
```

### Impact on existing code

The available balance calculation changes. Every place that currently computes `cached_balance - active_holds` must now also subtract pending withdrawal requests:

```typescript
// BEFORE (in PlaceHoldUseCase, WithdrawUseCase, TransferUseCase):
const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
const availableBalance = wallet.cachedBalanceCents - activeHolds;

// AFTER:
const activeHolds = await this.holdRepo.sumActiveHolds(txCtx, wallet.id);
const pendingWithdrawals = await this.withdrawalRequestRepo.sumPendingByWallet(txCtx, wallet.id);
const availableBalance = wallet.cachedBalanceCents - activeHolds - pendingWithdrawals;
```

Affected use cases:
- `PlaceHoldUseCase` — must subtract pending withdrawals from available balance
- `WithdrawUseCase` — must subtract pending withdrawals from available balance
- `TransferUseCase` — must subtract pending withdrawals from available balance
- `GetWalletUseCase` — the `available_balance_cents` field in the response must reflect pending withdrawals

This is **the main cost of this approach**: a cross-cutting change that touches 4 existing use cases. Any future operation that checks available balance must also account for pending withdrawal requests.

### Advantages

1. **Atomic consistency.** Everything is in one database, one transaction. No partial failures, no compensation jobs, no orphaned holds.
2. **Simpler deployment.** One service to deploy, monitor, and debug.
3. **Single source of truth.** The wallet service is authoritative for both the balance and the withdrawal status.
4. **No distributed coordination.** The approval flow is just a domain state machine within the same bounded context.
5. **Faster to implement.** No new service infrastructure, no inter-service communication, no HTTP client setup.

### Disadvantages

1. **Wallet becomes less generic.** It now knows about "approval workflows", which is a business concept, not a financial primitive. Next time you need a different approval flow (refund approval, escrow release), do you add another entity?
2. **Cross-cutting balance change.** Modifying available balance calculation affects 4+ existing use cases. Every future feature that checks balance must also know about pending withdrawals.
3. **Tighter coupling to the marketplace domain.** If another platform integrates and doesn't need approval workflows, the withdrawal request feature is dead weight.
4. **Harder to extract later.** If you eventually want a separate Payout Service, you'll need to migrate the entity, its data, and untangle the balance calculation.
5. **Bank transfer integration doesn't fit here.** After approval, someone still needs to initiate the actual bank transfer. That logic shouldn't live in the wallet. So you'll still need an external orchestrator for the "last mile" — reducing the benefit of putting approval in the wallet.

---

## Approach C — Payout as a separate bounded context in the same service (recommended)

### Philosophy

The payout workflow lives in its **own bounded context** (`src/payout/`) within the same service and the same database, but is architecturally isolated from the wallet context. The wallet remains a generic financial engine. The payout context delegates fund operations to the wallet through a **port defined in its own domain** — it never imports wallet entities or use cases directly.

This combines the consistency of Approach B (single DB transaction) with the separation of Approach A (wallet doesn't know about payouts).

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Wallet Service (single process)              │
│                                                                  │
│  ┌──────────────────────┐     ┌────────────────────────────┐    │
│  │  wallet/ context      │     │  payout/ context            │    │
│  │                       │     │                             │    │
│  │  Domain:              │     │  Domain:                    │    │
│  │  Wallet, Hold,        │     │  PayoutRequest              │    │
│  │  Transaction,         │     │                             │    │
│  │  Movement,            │     │  Ports:                     │    │
│  │  LedgerEntry          │     │  IFundReservationService    │    │
│  │                       │     │  IPayoutRequestRepository   │    │
│  │  Ports:               │     │                             │    │
│  │  IWalletRepository    │     │  Application:               │    │
│  │  IHoldRepository      │     │  RequestPayout              │    │
│  │  etc.                 │     │  ApprovePayout              │    │
│  │                       │     │  RejectPayout               │    │
│  │  No knowledge of      │     │  ListPayoutRequests         │    │
│  │  payouts whatsoever   │     │                             │    │
│  └──────────────────────┘     └─────────────┬───────────────┘    │
│                                              │                    │
│                                   ┌──────────▼──────────┐        │
│                                   │  Infrastructure:     │        │
│                                   │  WalletFundReserv-   │        │
│                                   │  ationAdapter        │        │
│                                   │                      │        │
│                                   │  Implements payout's │        │
│                                   │  port by dispatching │        │
│                                   │  wallet commands     │        │
│                                   │  via CommandBus      │        │
│                                   └─────────────────────┘        │
│                                                                  │
│  Shared: utils/ (kernel, CQRS buses, transaction manager)        │
│  Shared: same PostgreSQL database, same Prisma client            │
└──────────────────────────────────────────────────────────────────┘
```

### Key principle: boundary via ports, not direct imports

The payout context **never** imports wallet domain types. Instead:

1. The payout domain defines a port (`IFundReservationService`) that describes what it needs in its own language: "reserve funds", "capture reserved funds", "release reserved funds".
2. An infrastructure adapter implements that port by dispatching wallet commands through the `CommandBus`.
3. The adapter is the **only file** that crosses the boundary between contexts.

```
src/
├── wallet/                          ← Existing (unchanged)
│   ├── domain/
│   │   ├── wallet/, hold/, transaction/, movement/, ledgerEntry/
│   │   └── ports/
│   ├── application/
│   │   ├── command/ (deposit, withdraw, transfer, placeHold, captureHold, voidHold, ...)
│   │   └── query/ (getWallet, getTransactions, getLedgerEntries)
│   ├── infrastructure/
│   │   ├── adapters/inbound/http/
│   │   └── adapters/outbound/prisma/
│   └── wallet.module.ts
│
├── payout/                          ← New bounded context
│   ├── domain/
│   │   ├── payoutRequest/
│   │   │   ├── payoutRequest.entity.ts
│   │   │   └── payoutRequest.errors.ts
│   │   └── ports/
│   │       ├── fundReservation.port.ts         ← payout's own contract
│   │       └── payoutRequest.repository.ts
│   ├── application/
│   │   ├── command/
│   │   │   ├── requestPayout/  {command.ts, usecase.ts}
│   │   │   ├── approvePayout/  {command.ts, usecase.ts}
│   │   │   └── rejectPayout/   {command.ts, usecase.ts}
│   │   ├── query/
│   │   │   └── listPayoutRequests/ {query.ts, usecase.ts}
│   │   └── ports/
│   │       └── payoutRequest.readstore.ts
│   ├── infrastructure/
│   │   ├── adapters/
│   │   │   ├── inbound/http/
│   │   │   │   ├── requestPayout/    {handler.ts, schemas.ts}
│   │   │   │   ├── approvePayout/    {handler.ts, schemas.ts}
│   │   │   │   ├── rejectPayout/     {handler.ts, schemas.ts}
│   │   │   │   ├── listPayoutRequests/ {handler.ts, schemas.ts}
│   │   │   │   └── payoutRequests.routes.ts
│   │   │   └── outbound/
│   │   │       ├── prisma/
│   │   │       │   ├── payoutRequest.repo.ts
│   │   │       │   └── payoutRequest.readstore.ts
│   │   │       └── wallet/
│   │   │           └── fundReservation.adapter.ts  ← crosses boundary
│   │   └── adapters/inbound/scheduler/
│   │       └── jobs.ts                             ← expired hold detection
│   └── payout.module.ts
│
├── platform/                        ← Existing (unchanged)
├── common/                          ← Existing (unchanged)
├── utils/                           ← Existing (unchanged)
├── wiring.ts                        ← Modified: add payout module
└── index.ts                         ← Modified: mount payout routes
```

### Domain: PayoutRequest entity

```typescript
// src/payout/domain/payoutRequest/payoutRequest.entity.ts

export type PayoutRequestStatus = "pending" | "approved" | "rejected";

export class PayoutRequest {
  private readonly _id: string;
  private readonly _walletId: string;
  private readonly _platformId: string;
  private _holdId: string;
  private readonly _amountCents: bigint;
  private _status: PayoutRequestStatus;
  private _transactionId: string | null;
  private _movementId: string | null;
  private _reason: string | null;
  private _reviewedBy: string | null;
  private _reviewedAt: number | null;
  private readonly _reference: string | null;
  private readonly _metadata: Record<string, unknown> | null;
  private readonly _createdAt: number;
  private _updatedAt: number;

  // ... private constructor, create(), reconstruct(), getters ...

  approve(transactionId: string, movementId: string, reviewedBy: string, now: number): void {
    if (this._status !== "pending") {
      throw AppError.domainRule(
        "PAYOUT_REQUEST_NOT_PENDING",
        `payout request ${this._id} is not pending (status: ${this._status})`,
      );
    }
    this._status = "approved";
    this._transactionId = transactionId;
    this._movementId = movementId;
    this._reviewedBy = reviewedBy;
    this._reviewedAt = now;
    this._updatedAt = now;
  }

  reject(reason: string, reviewedBy: string, now: number): void {
    if (this._status !== "pending") {
      throw AppError.domainRule(
        "PAYOUT_REQUEST_NOT_PENDING",
        `payout request ${this._id} is not pending (status: ${this._status})`,
      );
    }
    this._status = "rejected";
    this._reason = reason;
    this._reviewedBy = reviewedBy;
    this._reviewedAt = now;
    this._updatedAt = now;
  }
}
```

### Domain: Fund reservation port

This is the critical boundary. The payout context defines **what it needs** without knowing how the wallet implements it:

```typescript
// src/payout/domain/ports/fundReservation.port.ts

import type { AppContext } from "../../../utils/kernel/context.js";

export interface ReserveFundsResult {
  holdId: string;
}

export interface CaptureFundsResult {
  transactionId: string;
  movementId: string;
}

export interface IFundReservationService {
  /**
   * Reserve funds in a wallet. The reserved amount reduces available balance
   * but does not move money. Returns a hold identifier for later capture/release.
   */
  reserve(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    amountCents: bigint,
    reference: string | null,
  ): Promise<ReserveFundsResult>;

  /**
   * Capture previously reserved funds. Money leaves the wallet.
   * Creates a transaction and ledger entries.
   */
  capture(
    ctx: AppContext,
    holdId: string,
    platformId: string,
    idempotencyKey: string,
  ): Promise<CaptureFundsResult>;

  /**
   * Release previously reserved funds back to available balance.
   * No money moves, no transaction is created.
   */
  release(
    ctx: AppContext,
    holdId: string,
    platformId: string,
  ): Promise<void>;
}
```

Note: this port imports **nothing** from `src/wallet/`. It lives entirely in the payout domain. The types (`ReserveFundsResult`, `CaptureFundsResult`) are defined by the payout context in its own terms.

### Infrastructure: adapter that crosses the boundary

The adapter is the **only file in the payout context** that imports wallet types:

```typescript
// src/payout/infrastructure/adapters/outbound/wallet/fundReservation.adapter.ts

import type { ICommandBus } from "../../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../../utils/kernel/context.js";
import type {
  IFundReservationService,
  ReserveFundsResult,
  CaptureFundsResult,
} from "../../../../domain/ports/fundReservation.port.js";

// ── These imports cross the bounded context boundary ──
// This adapter is the ONLY place where payout depends on wallet types.
import { PlaceHoldCommand } from "../../../../../wallet/application/command/placeHold/command.js";
import { CaptureHoldCommand } from "../../../../../wallet/application/command/captureHold/command.js";
import { VoidHoldCommand } from "../../../../../wallet/application/command/voidHold/command.js";

export class WalletFundReservationAdapter implements IFundReservationService {
  constructor(private readonly commandBus: ICommandBus) {}

  async reserve(
    ctx: AppContext,
    walletId: string,
    platformId: string,
    amountCents: bigint,
    reference: string | null,
  ): Promise<ReserveFundsResult> {
    const result = await this.commandBus.dispatch(
      ctx,
      new PlaceHoldCommand(walletId, platformId, amountCents, reference ?? undefined),
    );
    return { holdId: result.holdId };
  }

  async capture(
    ctx: AppContext,
    holdId: string,
    platformId: string,
    idempotencyKey: string,
  ): Promise<CaptureFundsResult> {
    const result = await this.commandBus.dispatch(
      ctx,
      new CaptureHoldCommand(holdId, platformId, idempotencyKey),
    );
    return { transactionId: result.transactionId, movementId: result.movementId };
  }

  async release(
    ctx: AppContext,
    holdId: string,
    platformId: string,
  ): Promise<void> {
    await this.commandBus.dispatch(
      ctx,
      new VoidHoldCommand(holdId, platformId),
    );
  }
}
```

### Application: use cases

#### RequestPayout

```typescript
// src/payout/application/command/requestPayout/usecase.ts

export class RequestPayoutUseCase implements ICommandHandler<RequestPayoutCommand, RequestPayoutResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly fundService: IFundReservationService,
    private readonly payoutRepo: IPayoutRequestRepository,
    private readonly idGen: IIDGenerator,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: RequestPayoutCommand): Promise<RequestPayoutResult> {
    const payoutId = this.idGen.newId();

    await this.txManager.run(ctx, async (txCtx) => {
      // 1. Reserve funds via port (wallet context handles validation)
      const { holdId } = await this.fundService.reserve(
        txCtx,
        cmd.walletId,
        cmd.platformId,
        cmd.amountCents,
        `payout:${payoutId}`,
      );

      // 2. Create payout request in payout context
      const payout = PayoutRequest.create({
        id: payoutId,
        walletId: cmd.walletId,
        platformId: cmd.platformId,
        holdId,
        amountCents: cmd.amountCents,
        reference: cmd.reference ?? null,
        metadata: cmd.metadata ?? null,
        now: Date.now(),
      });

      await this.payoutRepo.save(txCtx, payout);
    });
    // Both the hold AND the payout request are persisted in the SAME
    // database transaction. If either fails, both roll back.
    // No orphaned holds. No compensation jobs.

    return { payoutRequestId: payoutId };
  }
}
```

#### ApprovePayout

```typescript
// src/payout/application/command/approvePayout/usecase.ts

export class ApprovePayoutUseCase implements ICommandHandler<ApprovePayoutCommand, ApprovePayoutResult> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly fundService: IFundReservationService,
    private readonly payoutRepo: IPayoutRequestRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: ApprovePayoutCommand): Promise<ApprovePayoutResult> {
    let transactionId = "";
    let movementId = "";

    await this.txManager.run(ctx, async (txCtx) => {
      const payout = await this.payoutRepo.findById(txCtx, cmd.payoutRequestId);
      if (!payout) throw ErrPayoutRequestNotFound(cmd.payoutRequestId);
      if (payout.platformId !== cmd.platformId) throw ErrPayoutRequestNotFound(cmd.payoutRequestId);

      // Guard: must be pending (domain rule in entity)
      // This will throw PAYOUT_REQUEST_NOT_PENDING if not pending

      // Capture reserved funds via port
      // If the underlying hold expired, the wallet context throws HOLD_NOT_ACTIVE
      // or HOLD_EXPIRED. We catch it and auto-reject the payout request.
      try {
        const result = await this.fundService.capture(
          txCtx,
          payout.holdId,
          cmd.platformId,
          cmd.idempotencyKey,
        );
        transactionId = result.transactionId;
        movementId = result.movementId;
      } catch (err) {
        if (AppError.is(err) && (err.code === "HOLD_NOT_ACTIVE" || err.code === "HOLD_EXPIRED")) {
          payout.reject("hold_expired", "system", Date.now());
          await this.payoutRepo.save(txCtx, payout);
          throw AppError.domainRule(
            "PAYOUT_HOLD_EXPIRED",
            `payout request ${payout.id}: underlying hold expired`,
          );
        }
        throw err;
      }

      payout.approve(transactionId, movementId, cmd.reviewedBy, Date.now());
      await this.payoutRepo.save(txCtx, payout);
    });

    return { transactionId, movementId };
  }
}
```

#### RejectPayout

```typescript
// src/payout/application/command/rejectPayout/usecase.ts

export class RejectPayoutUseCase implements ICommandHandler<RejectPayoutCommand, void> {
  constructor(
    private readonly txManager: ITransactionManager,
    private readonly fundService: IFundReservationService,
    private readonly payoutRepo: IPayoutRequestRepository,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, cmd: RejectPayoutCommand): Promise<void> {
    await this.txManager.run(ctx, async (txCtx) => {
      const payout = await this.payoutRepo.findById(txCtx, cmd.payoutRequestId);
      if (!payout) throw ErrPayoutRequestNotFound(cmd.payoutRequestId);
      if (payout.platformId !== cmd.platformId) throw ErrPayoutRequestNotFound(cmd.payoutRequestId);

      // Release reserved funds via port
      // If hold already expired/voided, that's fine — just reject the payout
      try {
        await this.fundService.release(txCtx, payout.holdId, cmd.platformId);
      } catch (err) {
        if (AppError.is(err) && (err.code === "HOLD_NOT_ACTIVE" || err.code === "HOLD_EXPIRED")) {
          // Hold already gone — proceed with rejection anyway
          this.logger.info(txCtx, "RejectPayout: hold already inactive, proceeding with rejection");
        } else {
          throw err;
        }
      }

      payout.reject(cmd.reason, cmd.reviewedBy, Date.now());
      await this.payoutRepo.save(txCtx, payout);
    });
  }
}
```

### Database schema

```prisma
// Added to prisma/schema.prisma

model PayoutRequest {
  id            String  @id
  walletId      String  @map("wallet_id")
  platformId    String  @map("platform_id")
  holdId        String  @unique @map("hold_id")
  amountCents   BigInt  @map("amount_cents")
  status        String  @default("pending") /// pending | approved | rejected
  transactionId String? @unique @map("transaction_id")
  movementId    String? @map("movement_id")
  reason        String?
  reviewedBy    String? @map("reviewed_by")
  reviewedAt    BigInt? @map("reviewed_at")
  reference     String?
  metadata      Json?
  createdAt     BigInt  @map("created_at")
  updatedAt     BigInt  @map("updated_at")

  @@index([walletId, status])
  @@index([walletId, createdAt])
  @@index([status, createdAt])
  @@index([platformId, status])
  @@map("payout_requests")
}
```

Note: no foreign key to `Wallet` or `Hold`. The payout context references them by ID but doesn't declare Prisma relations. This keeps the schema boundary clean — the payout table can be extracted to a separate database later without FK migration headaches.

### HTTP endpoints

```
POST   /v1/payout-requests
  Auth: required | Idempotency: required | Status: 201
  Body: { wallet_id, amount_cents, reference?, metadata? }
  Response: { payout_request_id, hold_id }

POST   /v1/payout-requests/:id/approve
  Auth: required | Idempotency: required | Status: 200
  Body: { reviewed_by }
  Response: { transaction_id, movement_id }

POST   /v1/payout-requests/:id/reject
  Auth: required | Idempotency: not required | Status: 200
  Body: { reviewed_by, reason }
  Response: { status: "rejected" }

GET    /v1/payout-requests
  Auth: required | Status: 200
  Query: filter[wallet_id] (required), filter[status], filter[created_at],
         filter[reviewed_by], sort, limit, cursor
  Response: { payout_requests: [...], next_cursor }
```

### Error codes

| Code | Status | When |
|---|---|---|
| `PAYOUT_REQUEST_NOT_FOUND` | 404 | Request doesn't exist or belongs to different platform |
| `PAYOUT_REQUEST_NOT_PENDING` | 422 | Trying to approve/reject a non-pending request |
| `PAYOUT_HOLD_EXPIRED` | 422 | Admin tried to approve but the underlying hold expired |

All wallet errors (`WALLET_NOT_FOUND`, `WALLET_NOT_ACTIVE`, `INSUFFICIENT_FUNDS`, etc.) bubble up naturally through the `IFundReservationService` port since the wallet commands throw them and they propagate through the `CommandBus`.

### Wiring

```typescript
// src/payout/payout.module.ts

import type { ModuleHandlers, SharedInfra } from "../wiring.js";
import type { ICommandBus } from "../utils/application/cqrs.js";

import { PrismaPayoutRequestRepo } from "./infrastructure/adapters/outbound/prisma/payoutRequest.repo.js";
import { PrismaPayoutRequestReadStore } from "./infrastructure/adapters/outbound/prisma/payoutRequest.readstore.js";
import { WalletFundReservationAdapter } from "./infrastructure/adapters/outbound/wallet/fundReservation.adapter.js";

import { RequestPayoutUseCase } from "./application/command/requestPayout/usecase.js";
import { ApprovePayoutUseCase } from "./application/command/approvePayout/usecase.js";
import { RejectPayoutUseCase } from "./application/command/rejectPayout/usecase.js";
import { ListPayoutRequestsUseCase } from "./application/query/listPayoutRequests/usecase.js";

import { RequestPayoutCommand } from "./application/command/requestPayout/command.js";
import { ApprovePayoutCommand } from "./application/command/approvePayout/command.js";
import { RejectPayoutCommand } from "./application/command/rejectPayout/command.js";
import { ListPayoutRequestsQuery } from "./application/query/listPayoutRequests/query.js";

export function wire(
  { prisma, logger, idGen, txManager }: SharedInfra,
  commandBus: ICommandBus,  // needed to build the adapter
): ModuleHandlers {
  // Repos
  const payoutRepo = new PrismaPayoutRequestRepo(prisma, logger);
  const payoutReadStore = new PrismaPayoutRequestReadStore(prisma, logger);

  // Anti-corruption adapter: payout → wallet
  const fundService = new WalletFundReservationAdapter(commandBus);

  // Use cases
  const requestPayout = new RequestPayoutUseCase(txManager, fundService, payoutRepo, idGen, logger);
  const approvePayout = new ApprovePayoutUseCase(txManager, fundService, payoutRepo, logger);
  const rejectPayout = new RejectPayoutUseCase(txManager, fundService, payoutRepo, logger);
  const listPayoutRequests = new ListPayoutRequestsUseCase(payoutReadStore, logger);

  return {
    commands: [
      { type: RequestPayoutCommand.TYPE, handler: requestPayout },
      { type: ApprovePayoutCommand.TYPE, handler: approvePayout },
      { type: RejectPayoutCommand.TYPE, handler: rejectPayout },
    ],
    queries: [
      { type: ListPayoutRequestsQuery.TYPE, handler: listPayoutRequests },
    ],
  };
}
```

Note: the payout module receives `commandBus` as a parameter because the `WalletFundReservationAdapter` needs it. This means `wiring.ts` must create the `CommandBus` first, wire the wallet module (which registers hold commands on the bus), then wire the payout module (which uses the bus to call those commands).

```typescript
// In wiring.ts — wire order matters:

const commandBus = new CommandBus();
const queryBus = new QueryBus();

// 1. Wire wallet first (registers PlaceHold, CaptureHold, VoidHold on commandBus)
const wallet = WalletModule.wire(shared);
for (const c of wallet.commands ?? []) commandBus.register(c.type, c.handler);
for (const q of wallet.queries ?? []) queryBus.register(q.type, q.handler);

// 2. Wire payout second (its adapter dispatches wallet commands via commandBus)
const payout = PayoutModule.wire(shared, commandBus);
for (const c of payout.commands ?? []) commandBus.register(c.type, c.handler);
for (const q of payout.queries ?? []) queryBus.register(q.type, q.handler);

// 3. Wire remaining modules
const platform = PlatformModule.wire(shared);
const common = CommonModule.wire(shared);
// ...
```

### Edge cases

#### Hold expires before admin acts

The wallet's `ExpireHolds` background job marks expired holds automatically. When the admin tries to approve:

1. `ApprovePayout` calls `fundService.capture(holdId)`
2. `CaptureHoldUseCase` finds the hold is expired → throws `HOLD_NOT_ACTIVE` or detects expiry on-access → throws `HOLD_EXPIRED`
3. `ApprovePayout` catches the error → auto-rejects the payout request with reason `"hold_expired"` → throws `PAYOUT_HOLD_EXPIRED`

**Optional enhancement**: a scheduled job in the payout context that periodically finds pending payout requests and checks if their holds have expired, auto-rejecting them proactively so the admin panel stays clean.

#### Someone captures/voids the hold directly via `/holds/:id`

Since the payout context references the hold by ID, someone could call `POST /v1/holds/:id/capture` or `/void` directly, bypassing the payout workflow. The hold's `reference` field (`"payout:{id}"`) signals this, but there's no enforcement.

**For v1**: document that holds with `payout:*` references should not be manipulated directly. The payout API is the correct interface.

**For v2**: add a `managed_by` field to holds. When set, `CaptureHoldUseCase` and `VoidHoldUseCase` reject direct operations with `HOLD_MANAGED_EXTERNALLY`.

#### Transaction type after approval

The resulting transaction uses type `"hold_capture"` (not a new type), because that's what `CaptureHoldUseCase` produces. This is correct from the wallet's perspective — it captured a hold. The payout context adds the business meaning by linking its `PayoutRequest` to the resulting `transactionId`.

### Future extraction to microservice

If the payout context needs to become its own service:

```
BEFORE (same process, same DB):
  RequestPayoutUseCase
    → IFundReservationService
    → WalletFundReservationAdapter
    → CommandBus.dispatch(PlaceHoldCommand)  ← in-process call, same DB transaction

AFTER (separate service):
  RequestPayoutUseCase
    → IFundReservationService
    → HttpFundReservationAdapter             ← NEW: HTTP client to wallet API
    → POST /v1/holds                         ← network call
```

Changes needed:
1. Replace `WalletFundReservationAdapter` with `HttpFundReservationAdapter`
2. Move `payout_requests` table to its own database
3. Add compensation/retry logic (same as Approach A) since it's now distributed
4. No changes to payout domain or use cases

### Advantages

1. **Atomic consistency** (like B). Hold creation + payout request persist in the same DB transaction. No orphaned holds, no compensation jobs.
2. **Wallet stays generic** (like A). Zero changes to the wallet context. It doesn't know payouts exist.
3. **Clean bounded context boundary**. The payout context defines its own port. Only one infrastructure file crosses the boundary.
4. **Mechanical extraction**. Replace one adapter to go from monolith to microservices. Domain and use cases don't change.
5. **No cross-cutting balance changes**. Unlike Approach B, existing wallet use cases are untouched.
6. **Follows existing patterns**. Same CQRS, same module wiring, same folder structure. No new architectural concepts.

### Disadvantages

1. **Hold lifecycle mismatch**. The payout request's lifecycle doesn't control the hold's expiration. If a hold expires, the payout request must react. (Mitigated by auto-reject on approval attempt + optional background job.)
2. **Indirect hold manipulation risk**. Someone can bypass the payout API and operate on the hold directly. (Mitigated by convention in v1, `managed_by` guard in v2.)
3. **Transaction type is `hold_capture`**, not `withdrawal`. The ledger records it as a hold capture, not a withdrawal. Business meaning lives in the payout context, not in the ledger. (This is arguably correct — the wallet captured a hold; the payout context knows why.)
4. **Module wiring order matters**. The payout module must be wired after the wallet module so the bus has the hold commands registered.

---

## Comparison (all three)

| Dimension | A (Separate service) | B (In wallet context) | C (Separate context, same service) |
|---|---|---|---|
| **Consistency** | Eventually consistent | Strongly consistent | Strongly consistent |
| **Wallet changes** | None | +1 entity, +4 modified use cases | None |
| **New infrastructure** | New service + DB | New table | New context folder + table |
| **Failure handling** | Compensation jobs | Not needed | Not needed |
| **Wallet reusability** | Fully generic | Coupled to approval logic | Fully generic |
| **Boundary enforcement** | Network (HTTP) | None (same context) | Port/adapter (compile-time) |
| **Extraction cost** | Already separated | High (untangle balance calc) | Low (swap one adapter) |
| **Implementation effort** | High | Medium | Medium |
| **Operational overhead** | Two services | One service | One service |
| **Balance calc impact** | None | 4 use cases modified | None |
| **Bank transfer fit** | Natural | Awkward | Payout context or external |

---

## Recommendation

**Approach C** is recommended. It gives you:

- The architectural cleanliness of A (wallet stays generic, clear boundaries)
- The operational simplicity of B (one process, one database, atomic transactions)
- A clear extraction path to A when/if you need it

### When to choose differently

**Choose A** if you already have multiple services, a service mesh, and inter-service infrastructure in place. The extra operational complexity is worth it when you have the tooling to manage it.

**Choose B** if the wallet will only ever serve your marketplace, you want the absolute simplest implementation, and you're OK with the wallet being opinionated about your business domain.

---

## Implementation plan for Approach C

### New files (20)

| # | Layer | File |
|---|---|---|
| 1 | Domain | `src/payout/domain/payoutRequest/payoutRequest.entity.ts` |
| 2 | Domain | `src/payout/domain/payoutRequest/payoutRequest.errors.ts` |
| 3 | Domain port | `src/payout/domain/ports/fundReservation.port.ts` |
| 4 | Domain port | `src/payout/domain/ports/payoutRequest.repository.ts` |
| 5 | Application port | `src/payout/application/ports/payoutRequest.readstore.ts` |
| 6 | Application | `src/payout/application/command/requestPayout/command.ts` |
| 7 | Application | `src/payout/application/command/requestPayout/usecase.ts` |
| 8 | Application | `src/payout/application/command/approvePayout/command.ts` |
| 9 | Application | `src/payout/application/command/approvePayout/usecase.ts` |
| 10 | Application | `src/payout/application/command/rejectPayout/command.ts` |
| 11 | Application | `src/payout/application/command/rejectPayout/usecase.ts` |
| 12 | Application | `src/payout/application/query/listPayoutRequests/query.ts` |
| 13 | Application | `src/payout/application/query/listPayoutRequests/usecase.ts` |
| 14 | Infra (persistence) | `src/payout/infrastructure/adapters/outbound/prisma/payoutRequest.repo.ts` |
| 15 | Infra (persistence) | `src/payout/infrastructure/adapters/outbound/prisma/payoutRequest.readstore.ts` |
| 16 | Infra (adapter) | `src/payout/infrastructure/adapters/outbound/wallet/fundReservation.adapter.ts` |
| 17 | Infra (HTTP) | `src/payout/infrastructure/adapters/inbound/http/requestPayout/{handler.ts, schemas.ts}` |
| 18 | Infra (HTTP) | `src/payout/infrastructure/adapters/inbound/http/approvePayout/{handler.ts, schemas.ts}` |
| 19 | Infra (HTTP) | `src/payout/infrastructure/adapters/inbound/http/rejectPayout/{handler.ts, schemas.ts}` |
| 20 | Infra (HTTP) | `src/payout/infrastructure/adapters/inbound/http/listPayoutRequests/{handler.ts, schemas.ts}` |
| 21 | Infra (HTTP) | `src/payout/infrastructure/adapters/inbound/http/payoutRequests.routes.ts` |
| 22 | Module | `src/payout/payout.module.ts` |

### Modified files (3)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `PayoutRequest` model (no FK to wallet tables) |
| `src/wiring.ts` | Wire payout module after wallet module, pass commandBus |
| `src/index.ts` | Mount `/v1/payout-requests` route |

### Implementation sequence

1. **Prisma schema** — add `PayoutRequest` model, run migration
2. **Domain** — `PayoutRequest` entity + errors
3. **Ports** — `IFundReservationService`, `IPayoutRequestRepository`, `IPayoutRequestReadStore`
4. **Infrastructure (persistence)** — Prisma repo + read store
5. **Infrastructure (adapter)** — `WalletFundReservationAdapter`
6. **Use cases** — `RequestPayout`, `ApprovePayout`, `RejectPayout`, `ListPayoutRequests`
7. **HTTP handlers** — schemas + handlers for all 4 endpoints
8. **Routes** — `payoutRequests.routes.ts`
9. **Module** — `payout.module.ts`
10. **Wiring** — update `wiring.ts` (wire order) and `index.ts` (mount routes)
11. **Documentation** — update `WALLET_API.md` with payout endpoints
