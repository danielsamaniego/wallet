import { AppError } from "../../../../shared/appError.js";
import type { RequestContext } from "../../../../shared/kernel/context.js";
import type { IDGenerator } from "../../../../shared/kernel/idGenerator.js";
import type { Logger } from "../../../../shared/observability/logger.js";
import { Hold } from "../../../domain/hold/entity.js";
import type { UnitOfWork } from "../../../domain/ports/unitOfWork.js";
import { ErrWalletNotFound } from "../../../domain/wallet/errors.js";

export interface PlaceHoldCommand {
  walletId: string;
  amountCents: bigint;
  reference?: string;
  expiresAt?: number;
}

export interface PlaceHoldResult {
  holdId: string;
}

const mainLogTag = "PlaceHoldHandler";

export class PlaceHoldHandler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly idGen: IDGenerator,
    private readonly logger: Logger,
  ) {}

  async handle(ctx: RequestContext, cmd: PlaceHoldCommand): Promise<PlaceHoldResult> {
    const methodLogTag = `${mainLogTag} | handle`;

    const holdId = this.idGen.newId();

    await this.uow.run(async (repos) => {
      const wallet = await repos.wallets.findById(cmd.walletId);
      if (!wallet) {
        throw ErrWalletNotFound(cmd.walletId);
      }

      if (wallet.status !== "active") {
        throw AppError.domainRule("WALLET_NOT_ACTIVE", `wallet ${wallet.id} is not active`);
      }

      const now = Date.now();

      // Calculate available balance
      const activeHolds = await repos.holds.sumActiveHolds(wallet.id);
      const availableBalance = wallet.cachedBalanceCents - activeHolds;

      if (cmd.amountCents > availableBalance) {
        throw AppError.domainRule(
          "INSUFFICIENT_FUNDS",
          `wallet ${wallet.id} has insufficient available funds for hold`,
        );
      }

      const hold = Hold.create({
        id: holdId,
        walletId: wallet.id,
        amountCents: cmd.amountCents,
        reference: cmd.reference ?? null,
        expiresAt: cmd.expiresAt ?? null,
        now,
      });

      await repos.holds.save(hold);
    });

    this.logger.info(ctx, `${methodLogTag} hold placed`, {
      hold_id: holdId,
      wallet_id: cmd.walletId,
      amount_cents: Number(cmd.amountCents),
    });

    return { holdId };
  }
}
