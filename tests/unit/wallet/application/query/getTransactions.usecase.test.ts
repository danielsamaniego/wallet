import { mock, mockReset } from "vitest-mock-extended";
import { createMockLogger } from "@test/helpers/mocks/index.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { GetTransactionsUseCase } from "@/wallet/application/query/getTransactions/usecase.js";
import { GetTransactionsQuery } from "@/wallet/application/query/getTransactions/query.js";
import type { PaginatedTransactions, TransactionDTO } from "@/wallet/application/query/getTransactions/query.js";
import type { ITransactionReadStore } from "@/wallet/application/ports/transaction.readstore.js";
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

const txA: TransactionDTO = {
  id: "tx-1",
  wallet_id: WALLET_ID,
  counterpart_wallet_id: "wallet-2",
  type: "TRANSFER_OUT",
  amount_minor: 5000,
  status: "COMPLETED",
  idempotency_key: "idem-1",
  reference: "ref-001",
  metadata: { order_id: "order-1" },
  hold_id: null,
  created_at: 1700000000000,
};

const txB: TransactionDTO = {
  id: "tx-2",
  wallet_id: WALLET_ID,
  counterpart_wallet_id: null,
  type: "DEPOSIT",
  amount_minor: 10000,
  status: "COMPLETED",
  idempotency_key: "idem-2",
  reference: null,
  metadata: null,
  hold_id: null,
  created_at: 1700000001000,
};

// ── Test suite ─────────────────────────────────────────────────────

describe("GetTransactionsUseCase", () => {
  const readStore = mock<ITransactionReadStore>();
  const logger = createMockLogger();
  const useCase = new GetTransactionsUseCase(readStore, logger);
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(readStore);
  });

  // ── Paginated results ─────────────────────────────────────────

  describe("Given a wallet with transactions in the read store", () => {
    const paginatedResult: PaginatedTransactions = {
      transactions: [txA, txB],
      next_cursor: "cursor-xyz",
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(paginatedResult);
    });

    describe("When transactions are queried for the wallet", () => {
      it("Then it returns the paginated transactions", async () => {
        const query = new GetTransactionsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result).toEqual(paginatedResult);
        expect(result.transactions).toHaveLength(2);
        expect(result.next_cursor).toBe("cursor-xyz");
        expect(readStore.getByWallet).toHaveBeenCalledWith(ctx, WALLET_ID, PLATFORM_ID, listing);
      });
    });
  });

  // ── Empty results ─────────────────────────────────────────────

  describe("Given a wallet exists but has no transactions", () => {
    const emptyResult: PaginatedTransactions = {
      transactions: [],
      next_cursor: null,
    };

    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(emptyResult);
    });

    describe("When transactions are queried for the wallet", () => {
      it("Then it returns an empty transactions array with no cursor", async () => {
        const query = new GetTransactionsQuery(WALLET_ID, PLATFORM_ID, listing);

        const result = await useCase.handle(ctx, query);

        expect(result.transactions).toEqual([]);
        expect(result.next_cursor).toBeNull();
      });
    });
  });

  // ── Wallet not found ──────────────────────────────────────────

  describe("Given the wallet does not exist", () => {
    beforeEach(() => {
      readStore.getByWallet.mockResolvedValue(null);
    });

    describe("When transactions are queried for a non-existent wallet", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const query = new GetTransactionsQuery(WALLET_ID, PLATFORM_ID, listing);

        await expect(useCase.handle(ctx, query)).rejects.toSatisfy((err: AppError) => {
          return err.kind === ErrorKind.NotFound && err.code === "WALLET_NOT_FOUND";
        });
      });
    });
  });
});
