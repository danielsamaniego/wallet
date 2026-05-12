export type MovementType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "hold_capture"
  | "adjustment"
  | "charge";

export type MovementStatus = "pending" | "processing" | "posted" | "failed" | "reversed";

export class Movement {
  private readonly _id: string;
  private readonly _type: MovementType;
  private readonly _status: MovementStatus;
  /**
   * Denormalised owner platform. Required for new movements (set by every
   * use case / async-enqueue from the authenticated request context) so a
   * `pending` or `processing` movement — which has no transactions yet — is
   * still resolvable via cross-tenant filtering. Nullable in `reconstruct`
   * because the column is nullable in the DB: pre-Phase-2B legacy rows that
   * existed before the backfill could be null. Application code MUST treat
   * a null platformId as "legacy" and fall back to the transactional path
   * (`transactions.some.wallet.platformId`) when scoping reads.
   */
  private readonly _platformId: string | null;
  private readonly _reason: string | null;
  private readonly _failedReason: string | null;
  private readonly _createdAt: number;

  private constructor() {
    this._id = "";
    this._type = "deposit";
    this._status = "posted";
    this._platformId = null;
    this._reason = null;
    this._failedReason = null;
    this._createdAt = 0;
  }

  static create(params: {
    id: string;
    type: MovementType;
    platformId: string;
    status?: MovementStatus;
    reason?: string | null;
    failedReason?: string | null;
    createdAt: number;
  }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
      _status: params.status ?? "posted",
      _platformId: params.platformId,
      _reason: params.reason ?? null,
      _failedReason: params.failedReason ?? null,
      _createdAt: params.createdAt,
    });
    return m;
  }

  static reconstruct(params: {
    id: string;
    type: MovementType;
    status: MovementStatus;
    platformId: string | null;
    reason: string | null;
    failedReason: string | null;
    createdAt: number;
  }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
      _status: params.status,
      _platformId: params.platformId,
      _reason: params.reason,
      _failedReason: params.failedReason,
      _createdAt: params.createdAt,
    });
    return m;
  }

  get id(): string {
    return this._id;
  }
  get type(): MovementType {
    return this._type;
  }
  get status(): MovementStatus {
    return this._status;
  }
  get platformId(): string | null {
    return this._platformId;
  }
  get reason(): string | null {
    return this._reason;
  }
  get failedReason(): string | null {
    return this._failedReason;
  }
  get createdAt(): number {
    return this._createdAt;
  }
}
