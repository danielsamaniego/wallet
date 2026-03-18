import type { AppContext } from "../../../shared/domain/kernel/context.js";
import type { LedgerEntry } from "../ledgerEntry/ledgerEntry.entity.js";

export interface ILedgerEntryRepository {
  saveMany(ctx: AppContext, entries: LedgerEntry[]): Promise<void>;
}
