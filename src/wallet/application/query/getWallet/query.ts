import { IQuery } from "../../../../utils/application/cqrs.js";
/**
 * Wallet read DTO exposed to API consumers.
 * `version` is intentionally omitted — it is an internal optimistic locking
 * detail, not part of the public contract. Clients use idempotency keys
 * to handle VERSION_CONFLICT retries, not raw version numbers.
 */
export interface WalletDTO {
  id: string;
  owner_id: string;
  platform_id: string;
  currency_code: string;
  balance_minor: number | string;
  available_balance_minor: number | string;
  status: string;
  is_system: boolean;
  created_at: number;
  updated_at: number;
}

export class GetWalletQuery extends IQuery<WalletDTO> {
  static readonly TYPE = "GetWallet";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) {
    super(GetWalletQuery.TYPE);
  }
}
