import { ICommand } from "../../../../utils/application/cqrs.js";

/**
 * The kind of balance change a single operation applies:
 * - `deposit`  → credits the wallet, debits the platform treasury shard
 * - `withdraw` → debits the wallet, credits the platform treasury shard
 * - `charge`   → debits the wallet, credits the platform treasury shard (recorded
 *                as a platform-initiated fee rather than a user-initiated payout)
 * - `adjust`   → administrative correction. `amountMinor` is SIGNED (positive =
 *                credit, negative = debit) and a negative adjust may push the
 *                balance below zero only when the platform has
 *                `allowNegativeBalance` enabled and the wallet has no active holds.
 */
export type BatchOperationType = "deposit" | "withdraw" | "charge" | "adjust";

/**
 * One operation in the batch. For `deposit` / `withdraw` / `charge`,
 * `amountMinor` is a positive magnitude and the direction is derived from the
 * type. For `adjust`, `amountMinor` is signed. Each operation produces its own
 * movement (deposit / withdrawal / charge / adjustment) — exactly like the
 * single-operation commands.
 */
export interface BatchOperation {
  walletId: string;
  type: BatchOperationType;
  amountMinor: bigint;
  reason?: string;
}

export interface BatchOperationResult {
  movementId: string;
  transactionId: string;
}

export interface ApplyBatchOperationsResult {
  /** One result per operation, in the same order as the request. */
  operations: BatchOperationResult[];
}

/**
 * Apply N operations as a single atomic batch: each operation produces its own
 * normal movement (deposit / withdrawal / charge / adjustment), but all of them
 * commit in one SERIALIZABLE transaction under one idempotency key — either every
 * operation lands or none does. Credits are applied before debits so a debit can
 * draw on funds a sibling credit provides; each operation enforces its own
 * balance invariant (deposit/withdraw/charge keep the wallet non-negative; a
 * negative `adjust` honours the platform's `allowNegativeBalance` flag and the
 * active-holds rule).
 *
 * This is the primitive consumers use for intrinsically multi-step flows (e.g. a
 * settlement: sale credit + commission charge + holdback charge, plus the
 * occasional administrative adjustment) where partial application must be
 * impossible. Operations are correlated by the shared `reference` / `metadata`,
 * not by a synthetic grouping entity. All wallets must be active.
 */
export class ApplyBatchOperationsCommand extends ICommand<ApplyBatchOperationsResult> {
  static readonly TYPE = "ApplyBatchOperations";
  constructor(
    public readonly platformId: string,
    public readonly operations: BatchOperation[],
    public readonly idempotencyKey: string,
    public readonly systemWalletShardCount: number,
    /** Platform flag: when true, a negative `adjust` may drive the balance below zero. */
    public readonly allowNegativeBalance: boolean,
    /**
     * When false (default), operations are applied in a deterministic order
     * (credits → fund-requiring debits → balance-reducing adjusts) regardless of
     * request order. When true, they are applied in the exact request order —
     * the caller takes responsibility for funding (a debit before its funding
     * credit will fail with INSUFFICIENT_FUNDS).
     */
    public readonly preserveOperationOrder: boolean,
    public readonly reference?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(ApplyBatchOperationsCommand.TYPE);
  }
}
