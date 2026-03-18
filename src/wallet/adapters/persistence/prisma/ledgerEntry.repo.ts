import type { PrismaClient } from "@prisma/client";
import type { AppContext } from "../../../../shared/domain/kernel/context.js";
import type { ILogger } from "../../../../shared/domain/observability/logger.port.js";
import type { LedgerEntry } from "../../../domain/ledgerEntry/ledgerEntry.entity.js";
import type { ILedgerEntryRepository } from "../../../domain/ports/ledgerEntry.repository.js";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class PrismaLedgerEntryRepo implements ILedgerEntryRepository {
  constructor(
    private readonly prisma: PrismaTransactionClient,
    private readonly logger: ILogger,
  ) {}

  private client(ctx: AppContext): PrismaTransactionClient {
    return (ctx.opCtx as PrismaTransactionClient | undefined) ?? this.prisma;
  }

  async saveMany(ctx: AppContext, entries: LedgerEntry[]): Promise<void> {
    this.logger.debug(ctx, "LedgerEntryRepo | saveMany", { count: entries.length });
    if (entries.length === 0) return;
    await this.client(ctx).ledgerEntry.createMany({
      data: entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        walletId: e.walletId,
        entryType: e.entryType,
        amountCents: e.amountCents,
        balanceAfterCents: e.balanceAfterCents,
        createdAt: BigInt(e.createdAt),
      })),
    });
  }
}
