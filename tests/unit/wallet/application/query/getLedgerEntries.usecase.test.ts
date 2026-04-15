import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetLedgerEntriesUseCase } from "@/wallet/application/query/getLedgerEntries/usecase.js";
import { GetLedgerEntriesQuery } from "@/wallet/application/query/getLedgerEntries/query.js";
import type { PaginatedLedgerEntries, LedgerEntryDTO } from "@/wallet/application/query/getLedgerEntries/query.js";
import type { ILedgerEntryReadStore } from "@/wallet/application/ports/ledgerEntry.readstore.js";
import type { ListingQuery } from "@/utils/kernel/listing.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

// ── Shared fixtures ────────────────────────────────────────────────

const WALLET_ID = "wallet-1";
const PLATFORM_ID = "platform-1";

const listing: ListingQuery = {
  filters: [],
  sort: [{ field: "created_at", direction: "desc" }],
  limit: 20,
};

const entryA: LedgerEntryDTO = {
  id: "entry-1",
  transaction_id: "tx-1",
  wallet_id: WALLET_ID,
  entry_type: "DEBIT",
  amount_minor: 5000,
  balance_after_minor: 5000,
  created_at: 1700000000000,
};

const entryB: LedgerEntryDTO = {
  id: "entry-2",
  transaction_id: "tx-2",
  wallet_id: WALLET_ID,
  entry_type: "CREDIT",
  amount_minor: 3000,
  balance_after_minor: 8000,
  created_at: 1700000001000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("GetLedgerEntriesUseCase", () => {
  const readStore = mock<ILedgerEntryReadStore>();
  const logger = createMockLogger();
  const useCase = new GetLedgerEntriesUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Paginated results ─────────────────────────────────────────

  describe("Given a wallet with ledger entries in the read store", () => {
    const paginatedResult: PaginatedLedgerEntries = {
      ledger_entries: [entryA, entryB],
      next_cursor: "cursor-le-1",
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(paginatedResult);
    });

    describe("When ledger entries are queried for the wallet", () => {
      it("Then it returns the paginated ledger entries", async () => {
        const query = new GetLedgerEntriesQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginatedResult);
        expect(result.ledger_entries).toHaveLength(2);
        expect(result.next_cursor).toBe("cursor-le-1");
        expect(readStore.getByWallet).toHaveBeenCalledWith(ctx, WALLET_ID, PLATFORM_ID, listing);
      });
    });
  });

  // ── Empty results ─────────────────────────────────────────────

  describe("Given a wallet exists but has no ledger entries", () => {
    const emptyResult: PaginatedLedgerEntries = {
      ledger_entries: [],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(emptyResult);
    });

    describe("When ledger entries are queried for the wallet", () => {
      it("Then it returns an empty ledger entries array with no cursor", async () => {
        const query = new GetLedgerEntriesQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.ledger_entries).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  // ── Wallet not found ──────────────────────────────────────────

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(null);
    });

    describe("When ledger entries are queried for a non-existent wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new GetLedgerEntriesQuery(WALLET_ID, PLATFORM_ID, listing);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
