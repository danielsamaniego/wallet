import type { IQueryHandler } from "../../../../utils/application/cqrs.js";
import { AppError } from "../../../../utils/kernel/appError.js";
import type { AppContext } from "../../../../utils/kernel/context.js";
import type { ILogger } from "../../../../utils/kernel/observability/logger.port.js";
import type { IWalletMovementReadStore } from "../../ports/walletMovement.readstore.js";
import type { GetWalletMovementsQuery, PaginatedWalletMovements } from "./query.js";

const mainLogTag = "GetWalletMovementsUseCase";

export class GetWalletMovementsUseCase
  implements IQueryHandler<GetWalletMovementsQuery, PaginatedWalletMovements>
{
  constructor(
    private readonly readStore: IWalletMovementReadStore,
    private readonly logger: ILogger,
  ) {}

  async handle(ctx: AppContext, query: GetWalletMovementsQuery): Promise<PaginatedWalletMovements> {
    const methodLogTag = `${mainLogTag} | handle`;

    this.logger.debug(ctx, `${methodLogTag} start`, {
      wallet_id: query.walletId,
      limit: query.listing.limit,
      cursor: query.listing.cursor ?? null,
      filters_count: query.listing.filters.length,
      sort: query.listing.sort.map((s) => `${s.field}:${s.direction}`),
    });

    const result = await this.readStore.getByWallet(
      ctx,
      query.walletId,
      query.platformId,
      query.listing,
    );

    if (!result) {
      this.logger.warn(ctx, `${methodLogTag} wallet not found`, { wallet_id: query.walletId });
      throw AppError.notFound("WALLET_NOT_FOUND", `wallet ${query.walletId} not found`);
    }

    this.logger.info(ctx, `${methodLogTag} success`, {
      wallet_id: query.walletId,
      movements_count: result.movements.length,
      has_more: result.next_cursor !== null,
    });

    return result;
  }
}
