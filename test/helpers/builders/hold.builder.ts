import { Hold, type HoldStatus } from "@/wallet/domain/hold/hold.entity.js";

export class HoldBuilder {
  private props = {
    id: "hold-1",
    walletId: "wallet-1",
    amountCents: 1000n,
    status: "active" as HoldStatus,
    reference: null as string | null,
    expiresAt: null as number | null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  withId(id: string): this {
    this.props.id = id;
    return this;
  }

  withWalletId(walletId: string): this {
    this.props.walletId = walletId;
    return this;
  }

  withAmount(cents: bigint): this {
    this.props.amountCents = cents;
    return this;
  }

  withStatus(status: HoldStatus): this {
    this.props.status = status;
    return this;
  }

  withReference(ref: string): this {
    this.props.reference = ref;
    return this;
  }

  withExpiresAt(ts: number): this {
    this.props.expiresAt = ts;
    return this;
  }

  asCaptured(): this {
    this.props.status = "captured";
    return this;
  }

  asVoided(): this {
    this.props.status = "voided";
    return this;
  }

  asExpired(): this {
    this.props.status = "expired";
    return this;
  }

  build(): Hold {
    return Hold.reconstruct(this.props);
  }
}
