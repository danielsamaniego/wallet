import { AppError } from "../../../../shared/domain/appError.js";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { GetWalletQuery, IWalletReadStore, WalletDTO } from "./query.js";

const mainLogTag = "GetWalletHandler";

export class GetWalletHandler {
  constructor(
    private readonly readStore: IWalletReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetWalletQuery): Promise<WalletDTO> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, { wallet_id: query.walletId });

    const dto = await this.readStore.getById(ctx, query.walletId, query.platformId);
    if (!dto) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      status: dto.status,
    });

    return dto;
  }
}
