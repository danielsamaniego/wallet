export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "transfer_in"
  | "transfer_out"
  | "hold_capture";

export type TransactionStatus = "completed" | "failed" | "reversed";

export class Transaction {
  private readonly _id: string;
  private readonly _walletId: string;
  private readonly _counterpartWalletId: string | null;
  private readonly _type: TransactionType;
  private readonly _amountCents: bigint;
  private readonly _status: TransactionStatus;
  private readonly _idempotencyKey: string | null;
  private readonly _reference: string | null;
  private readonly _metadata: Record<string, unknown> | null;
  private readonly _holdId: string | null;
  private readonly _createdAt: number;

  private constructor() {
    this._id = "";
    this._walletId = "";
    this._counterpartWalletId = null;
    this._type = "deposit";
    this._amountCents = 0n;
    this._status = "completed";
    this._idempotencyKey = null;
    this._reference = null;
    this._metadata = null;
    this._holdId = null;
    this._createdAt = 0;
  }

  static create(params: {
    id: string;
    walletId: string;
    counterpartWalletId: string | null;
    type: TransactionType;
    amountCents: bigint;
    status: TransactionStatus;
    idempotencyKey: string | null;
    reference: string | null;
    metadata: Record<string, unknown> | null;
    holdId: string | null;
    createdAt: number;
  }): Transaction {
    const t = new Transaction();
    Object.assign(t, {
      _id: params.id,
      _walletId: params.walletId,
      _counterpartWalletId: params.counterpartWalletId,
      _type: params.type,
      _amountCents: params.amountCents,
      _status: params.status,
      _idempotencyKey: params.idempotencyKey,
      _reference: params.reference,
      _metadata: params.metadata,
      _holdId: params.holdId,
      _createdAt: params.createdAt,
    });
    return t;
  }

  static reconstruct(params: {
    id: string;
    walletId: string;
    counterpartWalletId: string | null;
    type: TransactionType;
    amountCents: bigint;
    status: TransactionStatus;
    idempotencyKey: string | null;
    reference: string | null;
    metadata: Record<string, unknown> | null;
    holdId: string | null;
    createdAt: number;
  }): Transaction {
    const t = new Transaction();
    Object.assign(t, {
      _id: params.id,
      _walletId: params.walletId,
      _counterpartWalletId: params.counterpartWalletId,
      _type: params.type,
      _amountCents: params.amountCents,
      _status: params.status,
      _idempotencyKey: params.idempotencyKey,
      _reference: params.reference,
      _metadata: params.metadata,
      _holdId: params.holdId,
      _createdAt: params.createdAt,
    });
    return t;
  }

  get id(): string {
    return this._id;
  }
  get walletId(): string {
    return this._walletId;
  }
  get counterpartWalletId(): string | null {
    return this._counterpartWalletId;
  }
  get type(): TransactionType {
    return this._type;
  }
  get amountCents(): bigint {
    return this._amountCents;
  }
  get status(): TransactionStatus {
    return this._status;
  }
  get idempotencyKey(): string | null {
    return this._idempotencyKey;
  }
  get reference(): string | null {
    return this._reference;
  }
  get metadata(): Record<string, unknown> | null {
    return this._metadata;
  }
  get holdId(): string | null {
    return this._holdId;
  }
  get createdAt(): number {
    return this._createdAt;
  }
}
