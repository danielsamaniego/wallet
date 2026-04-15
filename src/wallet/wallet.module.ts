import type { ModuleHandlers, SharedInfra } from "../wiring.js";
// Commands & Queries (for bus registration)
import { AdjustBalanceCommand } from "./application/command/adjustBalance/command.js";
import { AdjustBalanceUseCase } from "./application/command/adjustBalance/usecase.js";
import { CaptureHoldCommand } from "./application/command/captureHold/command.js";
// Use cases
import { CaptureHoldUseCase } from "./application/command/captureHold/usecase.js";
import { CloseWalletCommand } from "./application/command/closeWallet/command.js";
import { CloseWalletUseCase } from "./application/command/closeWallet/usecase.js";
import { CreateWalletCommand } from "./application/command/createWallet/command.js";
import { CreateWalletUseCase } from "./application/command/createWallet/usecase.js";
import { DepositCommand } from "./application/command/deposit/command.js";
import { DepositUseCase } from "./application/command/deposit/usecase.js";
import { ExpireHoldsCommand } from "./application/command/expireHolds/command.js";
import { ExpireHoldsUseCase } from "./application/command/expireHolds/usecase.js";
import { FreezeWalletCommand } from "./application/command/freezeWallet/command.js";
import { FreezeWalletUseCase } from "./application/command/freezeWallet/usecase.js";
// TODO(historical-import-temp): Remove these two imports together with the
// rest of the import-historical-entry feature after migration.
import { ImportHistoricalEntryCommand } from "./application/command/importHistoricalEntry/command.js";
import { ImportHistoricalEntryUseCase } from "./application/command/importHistoricalEntry/usecase.js";
import { PlaceHoldCommand } from "./application/command/placeHold/command.js";
import { PlaceHoldUseCase } from "./application/command/placeHold/usecase.js";
import { TransferCommand } from "./application/command/transfer/command.js";
import { TransferUseCase } from "./application/command/transfer/usecase.js";
import { UnfreezeWalletCommand } from "./application/command/unfreezeWallet/command.js";
import { UnfreezeWalletUseCase } from "./application/command/unfreezeWallet/usecase.js";
import { VoidHoldCommand } from "./application/command/voidHold/command.js";
import { VoidHoldUseCase } from "./application/command/voidHold/usecase.js";
import { WithdrawCommand } from "./application/command/withdraw/command.js";
import { WithdrawUseCase } from "./application/command/withdraw/usecase.js";
import { GetHoldQuery } from "./application/query/getHold/query.js";
import { GetHoldUseCase } from "./application/query/getHold/usecase.js";
import { GetLedgerEntriesQuery } from "./application/query/getLedgerEntries/query.js";
import { GetLedgerEntriesUseCase } from "./application/query/getLedgerEntries/usecase.js";
import { GetTransactionsQuery } from "./application/query/getTransactions/query.js";
import { GetTransactionsUseCase } from "./application/query/getTransactions/usecase.js";
import { GetWalletQuery } from "./application/query/getWallet/query.js";
import { GetWalletUseCase } from "./application/query/getWallet/usecase.js";
import { ListHoldsQuery } from "./application/query/listHolds/query.js";
import { ListHoldsUseCase } from "./application/query/listHolds/usecase.js";
import { ListWalletsQuery } from "./application/query/listWallets/query.js";
import { ListWalletsUseCase } from "./application/query/listWallets/usecase.js";
// Repos
import { PrismaHoldReadStore } from "./infrastructure/adapters/outbound/prisma/hold.readstore.js";
import { PrismaHoldRepo } from "./infrastructure/adapters/outbound/prisma/hold.repo.js";
import { PrismaLedgerEntryReadStore } from "./infrastructure/adapters/outbound/prisma/ledgerEntry.readstore.js";
import { PrismaLedgerEntryRepo } from "./infrastructure/adapters/outbound/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "./infrastructure/adapters/outbound/prisma/movement.repo.js";
import { PrismaTransactionReadStore } from "./infrastructure/adapters/outbound/prisma/transaction.readstore.js";
import { PrismaTransactionRepo } from "./infrastructure/adapters/outbound/prisma/transaction.repo.js";
import { PrismaWalletReadStore } from "./infrastructure/adapters/outbound/prisma/wallet.readstore.js";
import { PrismaWalletRepo } from "./infrastructure/adapters/outbound/prisma/wallet.repo.js";

export function wire({ prisma, logger, idGen, txManager }: SharedInfra): ModuleHandlers {
  // Repos
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
  const movementRepo = new PrismaMovementRepo(prisma, logger);
  const walletReadStore = new PrismaWalletReadStore(prisma, logger);
  const holdReadStore = new PrismaHoldReadStore(prisma, logger);
  const transactionReadStore = new PrismaTransactionReadStore(prisma, logger);
  const ledgerEntryReadStore = new PrismaLedgerEntryReadStore(prisma, logger);

  // Use cases
  const createWallet = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);
  const adjustBalance = new AdjustBalanceUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const deposit = new DepositUseCase(
    txManager,
    walletRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const withdraw = new WithdrawUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const freezeWallet = new FreezeWalletUseCase(txManager, walletRepo, logger);
  const unfreezeWallet = new UnfreezeWalletUseCase(txManager, walletRepo, logger);
  // TODO(historical-import-temp): Remove this use case instantiation together
  // with the rest of the import-historical-entry feature after migration.
  const importHistoricalEntry = new ImportHistoricalEntryUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const closeWallet = new CloseWalletUseCase(txManager, walletRepo, holdRepo, logger);
  const getWallet = new GetWalletUseCase(walletReadStore, logger);
  const listWallets = new ListWalletsUseCase(walletReadStore, logger);
  const getHold = new GetHoldUseCase(holdReadStore, logger);
  const listHolds = new ListHoldsUseCase(holdReadStore, logger);
  const getTransactions = new GetTransactionsUseCase(transactionReadStore, logger);
  const getLedgerEntries = new GetLedgerEntriesUseCase(ledgerEntryReadStore, logger);
  const transfer = new TransferUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const placeHold = new PlaceHoldUseCase(txManager, walletRepo, holdRepo, idGen, logger);
  const captureHold = new CaptureHoldUseCase(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const voidHold = new VoidHoldUseCase(txManager, walletRepo, holdRepo, logger);
  const expireHolds = new ExpireHoldsUseCase(holdRepo, logger);

  return {
    commands: [
      { type: AdjustBalanceCommand.TYPE, handler: adjustBalance },
      // TODO(historical-import-temp): Remove this registration together with
      // the rest of the import-historical-entry feature after migration.
      { type: ImportHistoricalEntryCommand.TYPE, handler: importHistoricalEntry },
      { type: CreateWalletCommand.TYPE, handler: createWallet },
      { type: DepositCommand.TYPE, handler: deposit },
      { type: WithdrawCommand.TYPE, handler: withdraw },
      { type: TransferCommand.TYPE, handler: transfer },
      { type: FreezeWalletCommand.TYPE, handler: freezeWallet },
      { type: UnfreezeWalletCommand.TYPE, handler: unfreezeWallet },
      { type: CloseWalletCommand.TYPE, handler: closeWallet },
      { type: PlaceHoldCommand.TYPE, handler: placeHold },
      { type: CaptureHoldCommand.TYPE, handler: captureHold },
      { type: VoidHoldCommand.TYPE, handler: voidHold },
      { type: ExpireHoldsCommand.TYPE, handler: expireHolds },
    ],
    queries: [
      { type: GetWalletQuery.TYPE, handler: getWallet },
      { type: ListWalletsQuery.TYPE, handler: listWallets },
      { type: GetHoldQuery.TYPE, handler: getHold },
      { type: ListHoldsQuery.TYPE, handler: listHolds },
      { type: GetTransactionsQuery.TYPE, handler: getTransactions },
      { type: GetLedgerEntriesQuery.TYPE, handler: getLedgerEntries },
    ],
  };
}
