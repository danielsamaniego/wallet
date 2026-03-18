import { AppError } from "../../../../shared/appError.js";
import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { Logger } from "../../../../shared/observability/logger.js";

export interface GetWalletQuery {
  walletId: string;
  platformId: string;
}

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

export interface WalletReadStore {
  getById(walletId: string, platformId: string): Promise<WalletDTO | null>;
}

const mainLogTag = "GetWalletHandler";

export class GetWalletHandler {
  constructor(
    private readonly readStore: WalletReadStore,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, query: GetWalletQuery): Promise<WalletDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    const dto = await this.readStore.getById(query.walletId, query.platformId);
    if (!dto) {
      this.logger.info(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }
    return dto;
  }
}
