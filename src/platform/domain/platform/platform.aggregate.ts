import { AppError } from "../../../utils/kernel/appError.js";

export type PlatformStatus = "active" | "suspended" | "revoked";

export class Platform {
  private readonly _id: string;
  private _name: string;
  private readonly _apiKeyHash: string;
  private readonly _apiKeyId: string;
  private _status: PlatformStatus;
  private _createdAt: number;
  private _updatedAt: number;

  private constructor() {
    this._id = "";
    this._name = "";
    this._apiKeyHash = "";
    this._apiKeyId = "";
    this._status = "active";
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

  rename(newName: string, now: number): void {
    if (!newName || newName.trim().length === 0) {
      throw AppError.validation("INVALID_PLATFORM_NAME", "platform name must not be empty");
    }
    this._name = newName.trim();
    this._updatedAt = now;
  }

  suspend(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule("PLATFORM_REVOKED", `platform ${this._id} is revoked and cannot be suspended`);
    }
    if (this._status === "suspended") {
      throw AppError.domainRule("PLATFORM_ALREADY_SUSPENDED", `platform ${this._id} is already suspended`);
    }
    this._status = "suspended";
    this._updatedAt = now;
  }

  activate(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule("PLATFORM_REVOKED", `platform ${this._id} is revoked and cannot be activated`);
    }
    if (this._status === "active") {
      throw AppError.domainRule("PLATFORM_ALREADY_ACTIVE", `platform ${this._id} is already active`);
    }
    this._status = "active";
    this._updatedAt = now;
  }

  revoke(now: number): void {
    if (this._status === "revoked") {
      throw AppError.domainRule("PLATFORM_ALREADY_REVOKED", `platform ${this._id} is already revoked`);
    }
    this._status = "revoked";
    this._updatedAt = now;
  }
}
