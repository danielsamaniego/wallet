import { AppError } from "../../../shared/kernel/appError.js";

export type HoldStatus = "active" | "captured" | "voided" | "expired";

export class Hold {
  private readonly _id: string;
  private readonly _walletId: string;
  private readonly _amountCents: bigint;
  private _status: HoldStatus;
  private readonly _reference: string | null;
  private readonly _expiresAt: number | null;
  private readonly _createdAt: number;
  private _updatedAt: number;

  private constructor() {
    this._id = "";
    this._walletId = "";
    this._amountCents = 0n;
    this._status = "active";
    this._reference = null;
    this._expiresAt = null;
    this._createdAt = 0;
    this._updatedAt = 0;
  }

  static create(params: {
    id: string;
    walletId: string;
    amountCents: bigint;
    reference: string | null;
    expiresAt: number | null;
    now: number;
  }): Hold {
    if (params.amountCents <= 0n) {
      throw AppError.validation("INVALID_AMOUNT", "hold amount must be positive");
    }
    if (params.expiresAt !== null && params.expiresAt <= params.now) {
      throw AppError.validation("HOLD_EXPIRES_IN_PAST", "hold expiration must be in the future");
    }
    const h = new Hold();
    Object.assign(h, {
      _id: params.id,
      _walletId: params.walletId,
      _amountCents: params.amountCents,
      _status: "active",
      _reference: params.reference,
      _expiresAt: params.expiresAt,
      _createdAt: params.now,
      _updatedAt: params.now,
    });
    return h;
  }

  static reconstruct(params: {
    id: string;
    walletId: string;
    amountCents: bigint;
    status: HoldStatus;
    reference: string | null;
    expiresAt: number | null;
    createdAt: number;
    updatedAt: number;
  }): Hold {
    const h = new Hold();
    Object.assign(h, {
      _id: params.id,
      _walletId: params.walletId,
      _amountCents: params.amountCents,
      _status: params.status,
      _reference: params.reference,
      _expiresAt: params.expiresAt,
      _createdAt: params.createdAt,
      _updatedAt: params.updatedAt,
    });
    return h;
  }

  get id(): string {
    return this._id;
  }
  get walletId(): string {
    return this._walletId;
  }
  get amountCents(): bigint {
    return this._amountCents;
  }
  get status(): HoldStatus {
    return this._status;
  }
  get reference(): string | null {
    return this._reference;
  }
  get expiresAt(): number | null {
    return this._expiresAt;
  }
  get createdAt(): number {
    return this._createdAt;
  }
  get updatedAt(): number {
    return this._updatedAt;
  }

  isExpired(now: number): boolean {
    return this._status === "active" && this._expiresAt !== null && now >= this._expiresAt;
  }

  capture(now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule(
        "HOLD_NOT_ACTIVE",
        `hold ${this._id} is not active (status: ${this._status})`,
      );
    }
    this._status = "captured";
    this._updatedAt = now;
  }

  void_(now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule(
        "HOLD_NOT_ACTIVE",
        `hold ${this._id} is not active (status: ${this._status})`,
      );
    }
    this._status = "voided";
    this._updatedAt = now;
  }

  expire(now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule(
        "HOLD_NOT_ACTIVE",
        `hold ${this._id} is not active (status: ${this._status})`,
      );
    }
    this._status = "expired";
    this._updatedAt = now;
  }
}
