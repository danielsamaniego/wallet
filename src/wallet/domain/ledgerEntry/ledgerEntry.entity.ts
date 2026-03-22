import { AppError } from "../../../shared/kernel/appError.js";

export type EntryType = "CREDIT" | "DEBIT";

export class LedgerEntry {
  private readonly _id: string;
  private readonly _transactionId: string;
  private readonly _walletId: string;
  private readonly _entryType: EntryType;
  private readonly _amountCents: bigint;
  private readonly _balanceAfterCents: bigint;
  private readonly _movementId: string;
  private readonly _createdAt: number;

  private constructor() {
    this._id = "";
    this._transactionId = "";
    this._walletId = "";
    this._entryType = "CREDIT";
    this._amountCents = 0n;
    this._balanceAfterCents = 0n;
    this._movementId = "";
    this._createdAt = 0;
  }

  static create(params: {
    id: string;
    transactionId: string;
    walletId: string;
    entryType: EntryType;
    amountCents: bigint;
    balanceAfterCents: bigint;
    movementId: string;
    createdAt: number;
  }): LedgerEntry {
    if (params.entryType === "DEBIT" && params.amountCents > 0n) {
      throw AppError.validation(
        "INVALID_LEDGER_SIGN",
        "DEBIT entries must have non-positive amount",
      );
    }
    if (params.entryType === "CREDIT" && params.amountCents < 0n) {
      throw AppError.validation(
        "INVALID_LEDGER_SIGN",
        "CREDIT entries must have non-negative amount",
      );
    }
    const e = new LedgerEntry();
    Object.assign(e, {
      _id: params.id,
      _transactionId: params.transactionId,
      _walletId: params.walletId,
      _entryType: params.entryType,
      _amountCents: params.amountCents,
      _balanceAfterCents: params.balanceAfterCents,
      _movementId: params.movementId,
      _createdAt: params.createdAt,
    });
    return e;
  }

  static reconstruct(params: {
    id: string;
    transactionId: string;
    walletId: string;
    entryType: EntryType;
    amountCents: bigint;
    balanceAfterCents: bigint;
    movementId: string;
    createdAt: number;
  }): LedgerEntry {
    const e = new LedgerEntry();
    Object.assign(e, {
      _id: params.id,
      _transactionId: params.transactionId,
      _walletId: params.walletId,
      _entryType: params.entryType,
      _amountCents: params.amountCents,
      _balanceAfterCents: params.balanceAfterCents,
      _movementId: params.movementId,
      _createdAt: params.createdAt,
    });
    return e;
  }

  get id(): string {
    return this._id;
  }
  get transactionId(): string {
    return this._transactionId;
  }
  get walletId(): string {
    return this._walletId;
  }
  get entryType(): EntryType {
    return this._entryType;
  }
  get amountCents(): bigint {
    return this._amountCents;
  }
  get balanceAfterCents(): bigint {
    return this._balanceAfterCents;
  }
  get movementId(): string {
    return this._movementId;
  }
  get createdAt(): number {
    return this._createdAt;
  }
}
