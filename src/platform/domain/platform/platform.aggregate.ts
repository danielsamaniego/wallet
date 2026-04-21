import { AppError } from "../../../utils/kernel/appError.js";

export type PlatformStatus = "active" | "suspended" | "revoked";

/** Default number of shards for a brand-new platform's system wallets. */
export const DEFAULT_SYSTEM_WALLET_SHARD_COUNT = 32;
/** Inclusive upper bound; enforced both here and by the DB CHECK `ck_platform_shard_count_bounds`. */
export const MAX_SYSTEM_WALLET_SHARD_COUNT = 1024;

export class Platform {
  private readonly _id: string;
  private _name: string;
  private readonly _apiKeyHash: string;
  private readonly _apiKeyId: string;
  private _status: PlatformStatus;
  private _allowNegativeBalance: boolean;
  private _systemWalletShardCount: number;
  private _createdAt: number;
  private _updatedAt: number;

  private constructor() {
    this._id = "";
    this._name = "";
    this._apiKeyHash = "";
    this._apiKeyId = "";
    this._status = "active";
    this._allowNegativeBalance = false;
    this._systemWalletShardCount = DEFAULT_SYSTEM_WALLET_SHARD_COUNT;
    this._createdAt = 0;
    this._updatedAt = 0;
  }

  static create(
    id: string,
    name: string,
    apiKeyHash: string,
    apiKeyId: string,
    now: number,
  ): Platform {
    if (!name || name.trim().length === 0) {
      throw AppError.validation("INVALID_PLATFORM_NAME", "platform name must not be empty");
    }
    if (!apiKeyId || apiKeyId.trim().length === 0) {
      throw AppError.validation("INVALID_API_KEY_ID", "api key id must not be empty");
    }
    if (!apiKeyHash || apiKeyHash.trim().length === 0) {
      throw AppError.validation("INVALID_API_KEY_HASH", "api key hash must not be empty");
    }

    const p = new Platform();
    Object.assign(p, {
      _id: id,
      _name: name.trim(),
      _apiKeyHash: apiKeyHash,
      _apiKeyId: apiKeyId,
      _status: "active" as PlatformStatus,
      _allowNegativeBalance: false,
      _systemWalletShardCount: DEFAULT_SYSTEM_WALLET_SHARD_COUNT,
      _createdAt: now,
      _updatedAt: now,
    });
    return p;
  }

  static reconstruct(
    id: string,
    name: string,
    apiKeyHash: string,
    apiKeyId: string,
    status: PlatformStatus,
    allowNegativeBalance: boolean,
    systemWalletShardCount: number,
    createdAt: number,
    updatedAt: number,
  ): Platform {
    const p = new Platform();
    Object.assign(p, {
      _id: id,
      _name: name,
      _apiKeyHash: apiKeyHash,
      _apiKeyId: apiKeyId,
      _status: status,
      _allowNegativeBalance: allowNegativeBalance,
      _systemWalletShardCount: systemWalletShardCount,
      _createdAt: createdAt,
      _updatedAt: updatedAt,
    });
    return p;
  }

  get id(): string {
    return this._id;
  }
  get name(): string {
    return this._name;
  }
  get apiKeyHash(): string {
    return this._apiKeyHash;
  }
  get apiKeyId(): string {
    return this._apiKeyId;
  }
  get status(): PlatformStatus {
    return this._status;
  }
  get createdAt(): number {
    return this._createdAt;
  }
  get updatedAt(): number {
    return this._updatedAt;
  }
  get allowNegativeBalance(): boolean {
    return this._allowNegativeBalance;
  }
  get systemWalletShardCount(): number {
    return this._systemWalletShardCount;
  }

  rename(newName: string, now: number): void {
    if (!newName || newName.trim().length === 0) {
      throw AppError.validation("INVALID_PLATFORM_NAME", "platform name must not be empty");
    }
    this._name = newName.trim();
    this._updatedAt = now;
  }

  suspend(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule(
        "PLATFORM_REVOKED",
        `platform ${this._id} is revoked and cannot be suspended`,
      );
    }
    if (this._status === "suspended") {
      throw AppError.domainRule(
        "PLATFORM_ALREADY_SUSPENDED",
        `platform ${this._id} is already suspended`,
      );
    }
    this._status = "suspended";
    this._updatedAt = now;
  }

  activate(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule(
        "PLATFORM_REVOKED",
        `platform ${this._id} is revoked and cannot be activated`,
      );
    }
    if (this._status === "active") {
      throw AppError.domainRule(
        "PLATFORM_ALREADY_ACTIVE",
        `platform ${this._id} is already active`,
      );
    }
    this._status = "active";
    this._updatedAt = now;
  }

  revoke(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule(
        "PLATFORM_ALREADY_REVOKED",
        `platform ${this._id} is already revoked`,
      );
    }
    this._status = "revoked";
    this._updatedAt = now;
  }

  setAllowNegativeBalance(value: boolean, now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule(
        "PLATFORM_REVOKED",
        `platform ${this._id} is revoked and cannot be configured`,
      );
    }
    this._allowNegativeBalance = value;
    this._updatedAt = now;
  }

  /**
   * Updates the system wallet shard count. Can only increase (decreasing would
   * orphan balance in higher shards). Bounded at [1, MAX_SYSTEM_WALLET_SHARD_COUNT]
   * to match the DB CHECK constraint `ck_platform_shard_count_bounds`.
   *
   * Callers should invoke `ensureSystemWalletShards` on the wallet repository
   * for every currency already in use by this platform after persisting the
   * new count, so the new shards are eagerly materialised.
   */
  setSystemWalletShardCount(newCount: number, now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule(
        "PLATFORM_REVOKED",
        `platform ${this._id} is revoked and cannot be configured`,
      );
    }
    if (!Number.isInteger(newCount)) {
      throw AppError.validation(
        "INVALID_SHARD_COUNT",
        `system_wallet_shard_count must be an integer, got ${newCount}`,
      );
    }
    if (newCount < 1 || newCount > MAX_SYSTEM_WALLET_SHARD_COUNT) {
      throw AppError.validation(
        "INVALID_SHARD_COUNT",
        `system_wallet_shard_count must be between 1 and ${MAX_SYSTEM_WALLET_SHARD_COUNT}, got ${newCount}`,
      );
    }
    if (newCount < this._systemWalletShardCount) {
      throw AppError.domainRule(
        "SHARD_COUNT_DECREASE_NOT_ALLOWED",
        `system_wallet_shard_count can only be increased (current ${this._systemWalletShardCount}, requested ${newCount})`,
      );
    }
    this._systemWalletShardCount = newCount;
    this._updatedAt = now;
  }
}
