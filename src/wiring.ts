import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { IIdempotencyStore } from "./shared/infrastructure/http/middleware/idempotency.js";
import type { Config } from "./config.js";
import { UUIDV7Generator } from "./shared/infrastructure/kernel/uuidV7.js";
import { PinoAdapter } from "./shared/infrastructure/observability/pino.adapter.js";
import { SafeLogger } from "./shared/infrastructure/observability/safe.logger.js";
import { SensitiveKeysFilter } from "./shared/infrastructure/observability/sensitive.filter.js";
import type { IIDGenerator } from "./shared/application/id.generator.js";
import type { ILogger } from "./shared/kernel/observability/logger.port.js";
import type { ICommandBus, IQueryBus } from "./shared/application/cqrs.js";
import { CommandBus, QueryBus } from "./shared/infrastructure/kernel/bus.js";
import { PrismaHoldRepo } from "./wallet/infrastructure/adapters/outbound/prisma/hold.repo.js";
import { PrismaIdempotencyStore } from "./shared/infrastructure/persistence/prisma.idempotency.store.js";
import { PrismaLedgerEntryReadStore } from "./wallet/infrastructure/adapters/outbound/prisma/ledgerEntry.readstore.js";
import { PrismaLedgerEntryRepo } from "./wallet/infrastructure/adapters/outbound/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "./wallet/infrastructure/adapters/outbound/prisma/movement.repo.js";
import { PrismaTransactionManager } from "./shared/infrastructure/kernel/prisma.transaction.manager.js";
import { PrismaTransactionReadStore } from "./wallet/infrastructure/adapters/outbound/prisma/transaction.readstore.js";
import { PrismaTransactionRepo } from "./wallet/infrastructure/adapters/outbound/prisma/transaction.repo.js";
import { PrismaWalletReadStore } from "./wallet/infrastructure/adapters/outbound/prisma/wallet.readstore.js";
import { PrismaWalletRepo } from "./wallet/infrastructure/adapters/outbound/prisma/wallet.repo.js";
import { CaptureHoldUseCase } from "./wallet/application/command/captureHold/usecase.js";
import { CloseWalletUseCase } from "./wallet/application/command/closeWallet/usecase.js";
import { CreateWalletUseCase } from "./wallet/application/command/createWallet/usecase.js";
import { DepositUseCase } from "./wallet/application/command/deposit/usecase.js";
import { FreezeWalletUseCase } from "./wallet/application/command/freezeWallet/usecase.js";
import { PlaceHoldUseCase } from "./wallet/application/command/placeHold/usecase.js";
import { TransferUseCase } from "./wallet/application/command/transfer/usecase.js";
import { UnfreezeWalletUseCase } from "./wallet/application/command/unfreezeWallet/usecase.js";
import { VoidHoldUseCase } from "./wallet/application/command/voidHold/usecase.js";
import { WithdrawUseCase } from "./wallet/application/command/withdraw/usecase.js";
import { GetLedgerEntriesUseCase } from "./wallet/application/query/getLedgerEntries/usecase.js";
import { GetTransactionsUseCase } from "./wallet/application/query/getTransactions/usecase.js";
import { GetWalletUseCase } from "./wallet/application/query/getWallet/usecase.js";
import { ExpireHoldsUseCase } from "./wallet/application/command/expireHolds/usecase.js";
import { CleanupIdempotencyUseCase } from "./shared/application/command/cleanupIdempotency/usecase.js";

// Command classes (needed for bus registration)
import { CreateWalletCommand } from "./wallet/application/command/createWallet/command.js";
import { DepositCommand } from "./wallet/application/command/deposit/command.js";
import { WithdrawCommand } from "./wallet/application/command/withdraw/command.js";
import { TransferCommand } from "./wallet/application/command/transfer/command.js";
import { FreezeWalletCommand } from "./wallet/application/command/freezeWallet/command.js";
import { UnfreezeWalletCommand } from "./wallet/application/command/unfreezeWallet/command.js";
import { CloseWalletCommand } from "./wallet/application/command/closeWallet/command.js";
import { PlaceHoldCommand } from "./wallet/application/command/placeHold/command.js";
import { CaptureHoldCommand } from "./wallet/application/command/captureHold/command.js";
import { VoidHoldCommand } from "./wallet/application/command/voidHold/command.js";
import { ExpireHoldsCommand } from "./wallet/application/command/expireHolds/command.js";
import { CleanupIdempotencyCommand } from "./shared/application/command/cleanupIdempotency/command.js";

// Query classes (needed for bus registration)
import { GetWalletQuery } from "./wallet/application/query/getWallet/query.js";
import { GetTransactionsQuery } from "./wallet/application/query/getTransactions/query.js";
import { GetLedgerEntriesQuery } from "./wallet/application/query/getLedgerEntries/query.js";

/**
 * Dependencies holds all injected dependencies for the API.
 * Infrastructure, repos, and app handlers are wired once here
 * and shared across all route groups.
 */
export interface Dependencies {
  config: Config;
  prisma: PrismaClient;
  idGen: IIDGenerator;
  logger: ILogger;
  validateApiKey: (apiKey: string) => Promise<{ platformId: string } | null>;
  idempotencyStore: IIdempotencyStore;
  commandBus: ICommandBus;
  queryBus: IQueryBus;
}

const sensitiveKeys = [
  "password",
  "api_key",
  "api_key_hash",
  "secret",
  "token",
  "authorization",
  "cookie",
  "access_token",
  "refresh_token",
];

/**
 * Wire initializes and wires all dependencies.
 * Logger chain: PinoAdapter -> SensitiveKeysFilter -> SafeLogger
 */
export function wire(config: Config): Dependencies {
  const adapter = new PrismaPg({ connectionString: config.databaseUrl });
  const prisma = new PrismaClient({ adapter });

  const idGen = new UUIDV7Generator();
  const rawLogger = new PinoAdapter(config.logLevel);
  const filtered = new SensitiveKeysFilter(rawLogger, sensitiveKeys);
  const logger = new SafeLogger(filtered);

  const idempotencyStore = new PrismaIdempotencyStore(prisma, idGen);

  const validateApiKey = async (apiKey: string): Promise<{ platformId: string } | null> => {
    // apiKey format: "<api_key_id>.<secret>"
    const dotIndex = apiKey.indexOf(".");
    if (dotIndex === -1) return null;

    const apiKeyId = apiKey.substring(0, dotIndex);
    const secret = apiKey.substring(dotIndex + 1);

    const platform = await prisma.platform.findUnique({
      where: { apiKeyId },
    });

    if (!platform || platform.status !== "active") return null;

    const { createHash, timingSafeEqual } = await import("node:crypto");
    const hash = createHash("sha256").update(secret).digest("hex");
    if (
      hash.length !== platform.apiKeyHash.length ||
      !timingSafeEqual(Buffer.from(hash), Buffer.from(platform.apiKeyHash))
    ) {
      return null;
    }

    return { platformId: platform.id };
  };

  // Repos (instantiated once, shared across all route groups)
  const txManager = new PrismaTransactionManager(prisma, logger);
  const walletRepo = new PrismaWalletRepo(prisma, logger);
  const holdRepo = new PrismaHoldRepo(prisma, logger);
  const transactionRepo = new PrismaTransactionRepo(prisma, logger);
  const ledgerEntryRepo = new PrismaLedgerEntryRepo(prisma, logger);
  const movementRepo = new PrismaMovementRepo(prisma, logger);
  const walletReadStore = new PrismaWalletReadStore(prisma, logger);
  const transactionReadStore = new PrismaTransactionReadStore(prisma, logger);
  const ledgerEntryReadStore = new PrismaLedgerEntryReadStore(prisma, logger);

  // Use cases (pre-wired with repos)
  const createWallet = new CreateWalletUseCase(txManager, walletRepo, idGen, logger);
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
  const closeWallet = new CloseWalletUseCase(txManager, walletRepo, holdRepo, logger);
  const getWallet = new GetWalletUseCase(walletReadStore, logger);
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
  const cleanupIdempotency = new CleanupIdempotencyUseCase(idempotencyStore, logger);

  // ── Command Bus ────────────────────────────
  const commandBus = new CommandBus();
  commandBus.register(CreateWalletCommand.TYPE, createWallet);
  commandBus.register(DepositCommand.TYPE, deposit);
  commandBus.register(WithdrawCommand.TYPE, withdraw);
  commandBus.register(TransferCommand.TYPE, transfer);
  commandBus.register(FreezeWalletCommand.TYPE, freezeWallet);
  commandBus.register(UnfreezeWalletCommand.TYPE, unfreezeWallet);
  commandBus.register(CloseWalletCommand.TYPE, closeWallet);
  commandBus.register(PlaceHoldCommand.TYPE, placeHold);
  commandBus.register(CaptureHoldCommand.TYPE, captureHold);
  commandBus.register(VoidHoldCommand.TYPE, voidHold);
  commandBus.register(ExpireHoldsCommand.TYPE, expireHolds);
  commandBus.register(CleanupIdempotencyCommand.TYPE, cleanupIdempotency);

  // ── Query Bus ──────────────────────────────
  const queryBus = new QueryBus();
  queryBus.register(GetWalletQuery.TYPE, getWallet);
  queryBus.register(GetTransactionsQuery.TYPE, getTransactions);
  queryBus.register(GetLedgerEntriesQuery.TYPE, getLedgerEntries);

  return {
    config,
    prisma,
    idGen,
    logger,
    validateApiKey,
    idempotencyStore,
    commandBus,
    queryBus,
  };
}
