import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { IIdempotencyStore } from "./api/middleware/idempotency.js";
import type { Config } from "./config.js";
import { UUIDV7Generator } from "./shared/adapters/kernel/uuidV7.js";
import { PinoAdapter } from "./shared/adapters/observability/pino.adapter.js";
import { SafeLogger } from "./shared/adapters/observability/safe.logger.js";
import { SensitiveKeysFilter } from "./shared/adapters/observability/sensitive.filter.js";
import type { IIDGenerator } from "./shared/domain/kernel/id.generator.js";
import type { ILogger } from "./shared/domain/observability/logger.port.js";
import { PrismaHoldRepo } from "./wallet/adapters/persistence/prisma/hold.repo.js";
import { PrismaIdempotencyStore } from "./wallet/adapters/persistence/prisma/idempotency.store.js";
import { PrismaLedgerEntryReadStore } from "./wallet/adapters/persistence/prisma/ledgerEntry.readstore.js";
import { PrismaLedgerEntryRepo } from "./wallet/adapters/persistence/prisma/ledgerEntry.repo.js";
import { PrismaMovementRepo } from "./wallet/adapters/persistence/prisma/movement.repo.js";
import { PrismaTransactionManager } from "./wallet/adapters/persistence/prisma/transaction.manager.js";
import { PrismaTransactionReadStore } from "./wallet/adapters/persistence/prisma/transaction.readstore.js";
import { PrismaTransactionRepo } from "./wallet/adapters/persistence/prisma/transaction.repo.js";
import { PrismaWalletReadStore } from "./wallet/adapters/persistence/prisma/wallet.readstore.js";
import { PrismaWalletRepo } from "./wallet/adapters/persistence/prisma/wallet.repo.js";
import { CaptureHoldHandler } from "./wallet/application/command/captureHold/handler.js";
import { CloseWalletHandler } from "./wallet/application/command/closeWallet/handler.js";
import { CreateWalletHandler } from "./wallet/application/command/createWallet/handler.js";
import { DepositHandler } from "./wallet/application/command/deposit/handler.js";
import { FreezeWalletHandler } from "./wallet/application/command/freezeWallet/handler.js";
import { PlaceHoldHandler } from "./wallet/application/command/placeHold/handler.js";
import { TransferHandler } from "./wallet/application/command/transfer/handler.js";
import { UnfreezeWalletHandler } from "./wallet/application/command/unfreezeWallet/handler.js";
import { VoidHoldHandler } from "./wallet/application/command/voidHold/handler.js";
import { WithdrawHandler } from "./wallet/application/command/withdraw/handler.js";
import { GetLedgerEntriesHandler } from "./wallet/application/query/getLedgerEntries/handler.js";
import { GetTransactionsHandler } from "./wallet/application/query/getTransactions/handler.js";
import { GetWalletHandler } from "./wallet/application/query/getWallet/handler.js";

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

  // App handlers (pre-wired with repos)
  createWallet: CreateWalletHandler;
  deposit: DepositHandler;
  withdraw: WithdrawHandler;
  freezeWallet: FreezeWalletHandler;
  unfreezeWallet: UnfreezeWalletHandler;
  closeWallet: CloseWalletHandler;
  getWallet: GetWalletHandler;
  getTransactions: GetTransactionsHandler;
  getLedgerEntries: GetLedgerEntriesHandler;
  transfer: TransferHandler;
  placeHold: PlaceHoldHandler;
  captureHold: CaptureHoldHandler;
  voidHold: VoidHoldHandler;
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

  // App handlers (pre-wired with repos)
  const createWallet = new CreateWalletHandler(txManager, walletRepo, idGen, logger);
  const deposit = new DepositHandler(
    txManager,
    walletRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const withdraw = new WithdrawHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const freezeWallet = new FreezeWalletHandler(txManager, walletRepo, logger);
  const unfreezeWallet = new UnfreezeWalletHandler(txManager, walletRepo, logger);
  const closeWallet = new CloseWalletHandler(txManager, walletRepo, holdRepo, logger);
  const getWallet = new GetWalletHandler(walletReadStore, logger);
  const getTransactions = new GetTransactionsHandler(transactionReadStore, logger);
  const getLedgerEntries = new GetLedgerEntriesHandler(ledgerEntryReadStore, logger);
  const transfer = new TransferHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const placeHold = new PlaceHoldHandler(txManager, walletRepo, holdRepo, idGen, logger);
  const captureHold = new CaptureHoldHandler(
    txManager,
    walletRepo,
    holdRepo,
    transactionRepo,
    ledgerEntryRepo,
    movementRepo,
    idGen,
    logger,
  );
  const voidHold = new VoidHoldHandler(txManager, walletRepo, holdRepo, logger);

  return {
    config,
    prisma,
    idGen,
    logger,
    validateApiKey,
    idempotencyStore,
    createWallet,
    deposit,
    withdraw,
    freezeWallet,
    unfreezeWallet,
    closeWallet,
    getWallet,
    getTransactions,
    getLedgerEntries,
    transfer,
    placeHold,
    captureHold,
    voidHold,
  };
}
