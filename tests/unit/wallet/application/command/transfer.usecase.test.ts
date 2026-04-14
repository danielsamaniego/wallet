import { mock, mockReset } from "vitest-mock-extended";
import {
  createMockIDGenerator,
  createMockLogger,
  createMockTransactionManager,
} from "@test/helpers/mocks/index.js";
import { WalletBuilder } from "@test/helpers/builders/wallet.builder.js";
import { createTestContext } from "@test/helpers/builders/context.builder.js";
import { TransferUseCase } from "@/wallet/application/command/transfer/usecase.js";
import { TransferCommand } from "@/wallet/application/command/transfer/command.js";
import type { IWalletRepository } from "@/wallet/domain/ports/wallet.repository.js";
import type { IHoldRepository } from "@/wallet/domain/ports/hold.repository.js";
import type { ITransactionRepository } from "@/wallet/domain/ports/transaction.repository.js";
import type { ILedgerEntryRepository } from "@/wallet/domain/ports/ledgerEntry.repository.js";
import type { IMovementRepository } from "@/wallet/domain/ports/movement.repository.js";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";
import type { Wallet } from "@/wallet/domain/wallet/wallet.aggregate.js";

// ── Shared fixtures ────────────────────────────────────────────────

const PLATFORM = "platform-1";
const CURRENCY = "USD";
const IDEMPOTENCY_KEY = "idem-1";

// IDs returned by the mock generator: sourceTxId, targetTxId, movementId, debitEntryId, creditEntryId
const SOURCE_TX_ID = "tx-out-1";
const TARGET_TX_ID = "tx-in-1";
const MOVEMENT_ID = "mov-1";
const DEBIT_ENTRY_ID = "le-debit-1";
const CREDIT_ENTRY_ID = "le-credit-1";

function makeIds(): string[] {
  return [SOURCE_TX_ID, TARGET_TX_ID, MOVEMENT_ID, DEBIT_ENTRY_ID, CREDIT_ENTRY_ID];
}

// ── Test suite ─────────────────────────────────────────────────────

describe("TransferUseCase", () => {
  const walletRepo = mock<IWalletRepository>();
  const holdRepo = mock<IHoldRepository>();
  const transactionRepo = mock<ITransactionRepository>();
  const ledgerEntryRepo = mock<ILedgerEntryRepository>();
  const movementRepo = mock<IMovementRepository>();
  const txManager = createMockTransactionManager();
  const logger = createMockLogger();
  let idGen: ReturnType<typeof createMockIDGenerator>;
  let useCase: TransferUseCase;
  const ctx = createTestContext();

  beforeEach(() => {
    mockReset(walletRepo);
    mockReset(holdRepo);
    mockReset(transactionRepo);
    mockReset(ledgerEntryRepo);
    mockReset(movementRepo);
    idGen = createMockIDGenerator(makeIds());
    useCase = new TransferUseCase(
      txManager,
      walletRepo,
      holdRepo,
      transactionRepo,
      ledgerEntryRepo,
      movementRepo,
      idGen,
      logger,
    );
  });

  // ── Happy path ─────────────────────────────────────────────────

  describe("Given two active wallets with the same currency and sufficient funds", () => {
    const sourceWallet = new WalletBuilder()
      .withId("wallet-source")
      .withPlatformId(PLATFORM)
      .withCurrency(CURRENCY)
      .withBalance(10000n) // $100.00
      .build();

    const targetWallet = new WalletBuilder()
      .withId("wallet-target")
      .withOwnerId("owner-target")
      .withPlatformId(PLATFORM)
      .withCurrency(CURRENCY)
      .withBalance(5000n) // $50.00
      .build();

    beforeEach(() => {
      walletRepo.findById
        .mockResolvedValueOnce(sourceWallet)
        .mockResolvedValueOnce(targetWallet);
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
    });

    describe("When a transfer of $25.00 is executed", () => {
      it("Then it returns sourceTransactionId, targetTransactionId, and movementId", async () => {
        const cmd = new TransferCommand(
          sourceWallet.id,
          targetWallet.id,
          PLATFORM,
          2500n,
          IDEMPOTENCY_KEY,
        );

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({
          sourceTransactionId: SOURCE_TX_ID,
          targetTransactionId: TARGET_TX_ID,
          movementId: MOVEMENT_ID,
        });
      });

      it("Then it creates 2 transactions (transfer_out + transfer_in)", async () => {
        const cmd = new TransferCommand(
          sourceWallet.id,
          targetWallet.id,
          PLATFORM,
          2500n,
          IDEMPOTENCY_KEY,
        );

        await useCase.handle(ctx, cmd);

        expect(transactionRepo.saveMany).toHaveBeenCalledOnce();
        const [transactions] = transactionRepo.saveMany.mock.calls[0]!.slice(1) as [unknown[]];
        expect(transactions).toHaveLength(2);
      });

      it("Then it creates 2 ledger entries (DEBIT + CREDIT)", async () => {
        const cmd = new TransferCommand(
          sourceWallet.id,
          targetWallet.id,
          PLATFORM,
          2500n,
          IDEMPOTENCY_KEY,
        );

        await useCase.handle(ctx, cmd);

        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
        const [entries] = ledgerEntryRepo.saveMany.mock.calls[0]!.slice(1) as [unknown[]];
        expect(entries).toHaveLength(2);
      });

      it("Then it creates 1 movement", async () => {
        const cmd = new TransferCommand(
          sourceWallet.id,
          targetWallet.id,
          PLATFORM,
          2500n,
          IDEMPOTENCY_KEY,
        );

        await useCase.handle(ctx, cmd);

        expect(movementRepo.save).toHaveBeenCalledOnce();
      });
    });
  });

  // ── Same wallet ────────────────────────────────────────────────

  describe("Given source and target are the same wallet", () => {
    describe("When a transfer is attempted", () => {
      it("Then it throws SAME_WALLET", async () => {
        const cmd = new TransferCommand(
          "wallet-same",
          "wallet-same",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "SAME_WALLET",
          kind: ErrorKind.Validation,
        });
      });
    });
  });

  // ── Currency mismatch ──────────────────────────────────────────

  describe("Given source wallet is USD and target wallet is EUR", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-usd")
        .withPlatformId(PLATFORM)
        .withCurrency("USD")
        .withBalance(10000n)
        .build();

      const target = new WalletBuilder()
        .withId("wallet-eur")
        .withOwnerId("owner-eur")
        .withPlatformId(PLATFORM)
        .withCurrency("EUR")
        .withBalance(5000n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
    });

    describe("When a transfer is attempted", () => {
      it("Then it throws CURRENCY_MISMATCH", async () => {
        const cmd = new TransferCommand(
          "wallet-usd",
          "wallet-eur",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "CURRENCY_MISMATCH",
          kind: ErrorKind.DomainRule,
        });
      });
    });
  });

  // ── Insufficient funds ─────────────────────────────────────────

  describe("Given source wallet has $100 balance with $60 in active holds", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-low")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(10000n) // $100.00
        .build();

      const target = new WalletBuilder()
        .withId("wallet-target-2")
        .withOwnerId("owner-target-2")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(5000n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
      holdRepo.sumActiveHolds.mockResolvedValue(6000n); // $60.00 held
    });

    describe("When a transfer of $50 is attempted (available = $40)", () => {
      it("Then it throws INSUFFICIENT_FUNDS", async () => {
        const cmd = new TransferCommand(
          "wallet-low",
          "wallet-target-2",
          PLATFORM,
          5000n, // $50 > $40 available
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "INSUFFICIENT_FUNDS",
          kind: ErrorKind.DomainRule,
        });
      });
    });
  });

  // ── Source wallet not found ─────────────────────────────────────

  describe("Given source wallet does not exist", () => {
    beforeEach(() => {
      walletRepo.findById.mockResolvedValueOnce(null);
    });

    describe("When a transfer is attempted", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const cmd = new TransferCommand(
          "wallet-missing",
          "wallet-target",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_NOT_FOUND",
          kind: ErrorKind.NotFound,
        });
      });
    });
  });

  // ── Target wallet not found ───────────────────────────────────

  describe("Given target wallet does not exist", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-src-ok")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(10000n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(null);
    });

    describe("When a transfer is attempted", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const cmd = new TransferCommand(
          "wallet-src-ok",
          "wallet-missing-tgt",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_NOT_FOUND",
          kind: ErrorKind.NotFound,
        });
      });
    });
  });

  // ── Platform mismatch on source ────────────────────────────────

  describe("Given source wallet belongs to a different platform", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-other-plat")
        .withPlatformId("platform-other")
        .withCurrency(CURRENCY)
        .withBalance(10000n)
        .build();

      walletRepo.findById.mockResolvedValueOnce(source);
    });

    describe("When a transfer is attempted with platform-1", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const cmd = new TransferCommand(
          "wallet-other-plat",
          "wallet-target",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_NOT_FOUND",
          kind: ErrorKind.NotFound,
        });
      });
    });
  });

  // ── Platform mismatch on target ────────────────────────────────

  describe("Given target wallet belongs to a different platform", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-source-ok")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(10000n)
        .build();

      const target = new WalletBuilder()
        .withId("wallet-target-bad-plat")
        .withOwnerId("owner-bad-plat")
        .withPlatformId("platform-other")
        .withCurrency(CURRENCY)
        .withBalance(5000n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
    });

    describe("When a transfer is attempted with platform-1", () => {
      it("Then it throws WALLET_NOT_FOUND", async () => {
        const cmd = new TransferCommand(
          "wallet-source-ok",
          "wallet-target-bad-plat",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        const err = await useCase.handle(ctx, cmd).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          code: "WALLET_NOT_FOUND",
          kind: ErrorKind.NotFound,
        });
      });
    });
  });

  // ── Deadlock prevention: ID-sorted save order ──────────────────

  describe("Given source.id > target.id (alphabetically)", () => {
    beforeEach(() => {
      // "wallet-zzz" > "wallet-aaa" — target should be saved first
      const source = new WalletBuilder()
        .withId("wallet-zzz")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(10000n)
        .build();

      const target = new WalletBuilder()
        .withId("wallet-aaa")
        .withOwnerId("owner-aaa")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(5000n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
    });

    describe("When a transfer is executed", () => {
      it("Then target wallet (lower ID) is saved before source wallet (higher ID)", async () => {
        const cmd = new TransferCommand(
          "wallet-zzz",
          "wallet-aaa",
          PLATFORM,
          1000n,
          IDEMPOTENCY_KEY,
        );

        await useCase.handle(ctx, cmd);

        // walletRepo.save is called twice: first with lower-ID wallet, then higher-ID wallet
        expect(walletRepo.save).toHaveBeenCalledTimes(2);
        const firstSavedWallet = walletRepo.save.mock.calls[0]![1] as Wallet;
        const secondSavedWallet = walletRepo.save.mock.calls[1]![1] as Wallet;
        expect(firstSavedWallet.id).toBe("wallet-aaa");
        expect(secondSavedWallet.id).toBe("wallet-zzz");
      });
    });
  });

  // ── Minimum transfer: 1 cent ───────────────────────────────────

  describe("Given two valid wallets with sufficient funds", () => {
    beforeEach(() => {
      const source = new WalletBuilder()
        .withId("wallet-min-src")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(1n) // exactly 1 cent
        .build();

      const target = new WalletBuilder()
        .withId("wallet-min-tgt")
        .withOwnerId("owner-min-tgt")
        .withPlatformId(PLATFORM)
        .withCurrency(CURRENCY)
        .withBalance(0n)
        .build();

      walletRepo.findById
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
      holdRepo.sumActiveHolds.mockResolvedValue(0n);
    });

    describe("When a transfer of 1 cent is executed", () => {
      it("Then it succeeds and returns valid IDs", async () => {
        const cmd = new TransferCommand(
          "wallet-min-src",
          "wallet-min-tgt",
          PLATFORM,
          1n,
          IDEMPOTENCY_KEY,
        );

        const result = await useCase.handle(ctx, cmd);

        expect(result).toEqual({
          sourceTransactionId: SOURCE_TX_ID,
          targetTransactionId: TARGET_TX_ID,
          movementId: MOVEMENT_ID,
        });
        expect(movementRepo.save).toHaveBeenCalledOnce();
        expect(transactionRepo.saveMany).toHaveBeenCalledOnce();
        expect(ledgerEntryRepo.saveMany).toHaveBeenCalledOnce();
      });
    });
  });
});
