import { Wallet, type WalletStatus } from "@/wallet/domain/wallet/wallet.aggregate.js";

export class WalletBuilder {
  private props = {
    id: "wallet-1",
    ownerId: "owner-1",
    platformId: "platform-1",
    currencyCode: "USD",
    cachedBalanceMinor: 0n,
    status: "active" as WalletStatus,
    version: 1,
    isSystem: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  withId(id: string): this {
    this.props.id = id;
    return this;
  }

  withOwnerId(ownerId: string): this {
    this.props.ownerId = ownerId;
    return this;
  }

  withPlatformId(platformId: string): this {
    this.props.platformId = platformId;
    return this;
  }

  withCurrency(code: string): this {
    this.props.currencyCode = code;
    return this;
  }

  withBalance(minor: bigint): this {
    this.props.cachedBalanceMinor = minor;
    return this;
  }

  withStatus(status: WalletStatus): this {
    this.props.status = status;
    return this;
  }

  withVersion(version: number): this {
    this.props.version = version;
    return this;
  }

  asSystem(): this {
    this.props.isSystem = true;
    this.props.ownerId = "SYSTEM";
    return this;
  }

  asFrozen(): this {
    this.props.status = "frozen";
    return this;
  }

  asClosed(): this {
    this.props.status = "closed";
    return this;
  }

  withCreatedAt(ts: number): this {
    this.props.createdAt = ts;
    return this;
  }

  withUpdatedAt(ts: number): this {
    this.props.updatedAt = ts;
    return this;
  }

  build(): Wallet {
    return Wallet.reconstruct(
      this.props.id,
      this.props.ownerId,
      this.props.platformId,
      this.props.currencyCode,
      this.props.cachedBalanceMinor,
      this.props.status,
      this.props.version,
      this.props.isSystem,
      this.props.createdAt,
      this.props.updatedAt,
    );
  }
}
