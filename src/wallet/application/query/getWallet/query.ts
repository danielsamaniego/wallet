import { IQuery } from "../../../../shared/application/cqrs.js";
import type { AppContext } from "../../../../shared/kernel/context.js";

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
  balance_cents: number | string;
  available_balance_cents: number | string;
  status: string;
  is_system: boolean;
  created_at: number;
  updated_at: number;
}

export class GetWalletQuery extends IQuery<WalletDTO> {
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
  ) {
    super();
  }
}

export interface IWalletReadStore {
  getById(ctx: AppContext, walletId: string, platformId: string): Promise<WalletDTO | null>;
}
