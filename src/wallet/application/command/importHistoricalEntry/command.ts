// TODO(historical-import-temp): Remove this entire feature after all legacy
// consumers have completed their historical import. Mirrors AdjustBalance
// but preserves an externally-supplied `historicalCreatedAt` as the journal
// entries' timestamp, so the imported chain of Transactions / LedgerEntries /
// Movements reflects the original event times rather than the import moment.
import { ICommand } from "../../../../utils/application/cqrs.js";

export interface ImportHistoricalEntryResult {
  transactionId: string;
  movementId: string;
}

export class ImportHistoricalEntryCommand extends ICommand<ImportHistoricalEntryResult> {
  static readonly TYPE = "ImportHistoricalEntry";
  constructor(
    public readonly walletId: string,
    public readonly platformId: string,
    public readonly amountMinor: bigint,
    public readonly reason: string,
    public readonly reference: string,
    public readonly idempotencyKey: string,
    public readonly historicalCreatedAt: number,
    public readonly systemWalletShardCount: number,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(ImportHistoricalEntryCommand.TYPE);
  }
}
