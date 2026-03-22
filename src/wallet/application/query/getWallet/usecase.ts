import { AppError } from "../../../../utils/kernel/appError.js";
import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { GetWalletQuery, WalletDTO } from "./query.js";
import type { IWalletReadStore } from "../../ports/wallet.readstore.js";

const mainLogTag = "GetWalletUseCase";

export class GetWalletUseCase implements IQueryHandler<GetWalletQuery, WalletDTO> {
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
