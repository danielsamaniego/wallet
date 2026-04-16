import { AppError } from "../../../utils/kernel/appError.js";
import { isSupportedCurrency } from "../../../utils/kernel/currency.js";
import {
  ErrAdjustWouldBreakActiveHolds,
  ErrInvalidCurrency,
  ErrUnsupportedCurrency,
} from "./wallet.errors.js";

export type WalletStatus = "active" | "frozen" | "closed";

export class Wallet {
  private readonly _id: string;
  private readonly _ownerId: string;
  private readonly _platformId: string;
  private readonly _currencyCode: string;
  private _cachedBalanceMinor: bigint;
  private _status: WalletStatus;
  private _version: number;
  private readonly _isSystem: boolean;
  private _createdAt: number;
  private _updatedAt: number;

  private constructor() {
    // Force usage of create/reconstruct
    this._id = "";
    this._ownerId = "";
    this._platformId = "";
    this._currencyCode = "";
    this._cachedBalanceMinor = 0n;
    this._status = "active";
    this._version = 0;
    this._isSystem = false;
    this._createdAt = 0;
    this._updatedAt = 0;
  }

  static create(
    id: string,
    ownerId: string,
    platformId: string,
    currencyCode: string,
    isSystem: boolean,
    now: number,
  ): Wallet {
    const upper = currencyCode.toUpperCase();
    if (!/^[A-Z]{3}$/.test(upper)) {
      throw ErrInvalidCurrency(currencyCode);
    }
    if (!isSupportedCurrency(upper)) {
      throw ErrUnsupportedCurrency(upper);
    }
    const w = new Wallet();
    Object.assign(w, {
      _id: id,
      _ownerId: ownerId,
      _platformId: platformId,
      _currencyCode: upper,
      _cachedBalanceMinor: 0n,
      _status: "active",
      _version: 1,
      _isSystem: isSystem,
      _createdAt: now,
      _updatedAt: now,
    });
    return w;
  }

  static reconstruct(
    id: string,
    ownerId: string,
    platformId: string,
    currencyCode: string,
    cachedBalanceMinor: bigint,
    status: WalletStatus,
    version: number,
    isSystem: boolean,
    createdAt: number,
    updatedAt: number,
  ): Wallet {
    const w = new Wallet();
    Object.assign(w, {
      _id: id,
      _ownerId: ownerId,
      _platformId: platformId,
      _currencyCode: currencyCode,
      _cachedBalanceMinor: cachedBalanceMinor,
      _status: status,
      _version: version,
      _isSystem: isSystem,
      _createdAt: createdAt,
      _updatedAt: updatedAt,
    });
    return w;
  }

  get id(): string {
    return this._id;
  }
  get ownerId(): string {
    return this._ownerId;
  }
  get platformId(): string {
    return this._platformId;
  }
  get currencyCode(): string {
    return this._currencyCode;
  }
  get cachedBalanceMinor(): bigint {
    return this._cachedBalanceMinor;
  }
  get status(): WalletStatus {
    return this._status;
  }
  get version(): number {
    return this._version;
  }
  get isSystem(): boolean {
    return this._isSystem;
  }
  get createdAt(): number {
    return this._createdAt;
  }
  get updatedAt(): number {
    return this._updatedAt;
  }

  deposit(amountMinor: bigint, now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${this._id} is not active`);
    }
    if (amountMinor <= 0n) {
      throw AppError.validation("INVALID_AMOUNT", "amount must be positive");
    }
    this._cachedBalanceMinor += amountMinor;
    this.touch(now);
  }

  withdraw(amountMinor: bigint, availableBalanceMinor: bigint, now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${this._id} is not active`);
    }
    if (amountMinor <= 0n) {
      throw AppError.validation("INVALID_AMOUNT", "amount must be positive");
    }
    if (!this._isSystem && availableBalanceMinor < amountMinor) {
      throw AppError.domainRule(
        "INSUFFICIENT_FUNDS",
        `wallet ${this._id} has insufficient available funds`,
      );
    }
    this._cachedBalanceMinor -= amountMinor;
    this.touch(now);
  }

  freeze(now: number): void {
    if (this._isSystem) {
      throw AppError.domainRule("CANNOT_FREEZE_SYSTEM_WALLET", "system wallets cannot be frozen");
    }
    if (this._status === "closed") {
      throw AppError.domainRule("WALLET_CLOSED", `wallet ${this._id} is closed`);
    }
    if (this._status === "frozen") {
      throw AppError.domainRule("WALLET_ALREADY_FROZEN", `wallet ${this._id} is already frozen`);
    }
    this._status = "frozen";
    this.touch(now);
  }

  unfreeze(now: number): void {
    if (this._status !== "frozen") {
      throw AppError.domainRule("WALLET_NOT_FROZEN", `wallet ${this._id} is not frozen`);
    }
    this._status = "active";
    this.touch(now);
  }

  close(activeHoldsCount: number, now: number): void {
    if (this._isSystem) {
      throw AppError.domainRule("CANNOT_CLOSE_SYSTEM_WALLET", "system wallets cannot be closed");
    }
    if (this._status === "closed") {
      throw AppError.domainRule("WALLET_CLOSED", `wallet ${this._id} is already closed`);
    }
    if (this._cachedBalanceMinor !== 0n) {
      throw AppError.domainRule(
        "WALLET_BALANCE_NOT_ZERO",
        `wallet ${this._id} must have zero balance to close`,
      );
    }
    if (activeHoldsCount > 0) {
      throw AppError.domainRule("WALLET_HAS_ACTIVE_HOLDS", `wallet ${this._id} has active holds`);
    }
    this._status = "closed";
    this.touch(now);
  }

  /** Administrative balance adjustment. Allowed on active and frozen wallets (not closed). */
  adjust(
    amountMinor: bigint,
    availableBalanceMinor: bigint,
    allowNegativeBalance: boolean,
    now: number,
  ): void {
    if (this._status === "closed") {
      throw AppError.domainRule("WALLET_CLOSED", `wallet ${this._id} is closed`);
    }
    if (amountMinor === 0n) {
      throw AppError.validation("INVALID_AMOUNT", "adjustment amount must not be zero");
    }
    if (amountMinor < 0n && !this._isSystem) {
      const wouldBeAvailable = availableBalanceMinor + amountMinor;
      if (wouldBeAvailable < 0n) {
        // Derive whether holds exist: available = cached - holds → holds = cached - available
        const activeHoldsMinor = this._cachedBalanceMinor - availableBalanceMinor;
        if (allowNegativeBalance && activeHoldsMinor > 0n) {
          throw ErrAdjustWouldBreakActiveHolds(this._id);
        }
        if (!allowNegativeBalance) {
          throw AppError.domainRule(
            "INSUFFICIENT_FUNDS",
            `wallet ${this._id} has insufficient available funds`,
          );
        }
        // allowNegativeBalance=true and no active holds: balance may go negative
      }
    }
    this._cachedBalanceMinor += amountMinor;
    this.touch(now);
  }

  /** Bump version without mutating balance. Used by PlaceHold/VoidHold to participate in optimistic locking. */
  touchForHoldChange(now: number): void {
    if (this._status !== "active") {
      throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${this._id} is not active`);
    }
    this.touch(now);
  }

  private touch(now: number): void {
    this._version += 1;
    this._updatedAt = now;
  }
}
