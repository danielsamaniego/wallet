import type { LedgerEntry } from "../ledgerEntry/entity.js";

export interface LedgerEntryRepository {
  saveMany(entries: LedgerEntry[]): Promise<void>;
}
