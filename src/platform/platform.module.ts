import { PrismaWalletRepo } from "../wallet/infrastructure/adapters/outbound/prisma/wallet.repo.js";
import type { ModuleHandlers, SharedInfra } from "../wiring.js";
// Commands
import { UpdatePlatformConfigCommand } from "./application/command/updatePlatformConfig/command.js";
import { UpdatePlatformConfigUseCase } from "./application/command/updatePlatformConfig/usecase.js";
// Queries (for bus registration)
import { ListPlatformsQuery } from "./application/query/listPlatforms/query.js";
// Use cases
import { ListPlatformsUseCase } from "./application/query/listPlatforms/usecase.js";
// Repos
import { PrismaPlatformReadStore } from "./infrastructure/adapters/outbound/prisma/platform.readstore.js";
import { PrismaPlatformRepo } from "./infrastructure/adapters/outbound/prisma/platform.repo.js";

export function wire({ prisma, logger, idGen, txManager }: SharedInfra): ModuleHandlers {
  const platformRepo = new PrismaPlatformRepo(prisma, logger);
  const platformReadStore = new PrismaPlatformReadStore(prisma, logger);
  // Cross-BC: UpdatePlatformConfig needs to materialise shards on the wallet
  // side when system_wallet_shard_count increases. Instantiating a dedicated
  // PrismaWalletRepo here is cheap (shared Prisma client) and avoids leaking
  // wallet-specific internals into SharedInfra.
  const walletRepo = new PrismaWalletRepo(prisma, logger, idGen);

  const listPlatforms = new ListPlatformsUseCase(platformReadStore, logger);
  const updatePlatformConfig = new UpdatePlatformConfigUseCase(
    txManager,
    platformRepo,
    walletRepo,
    logger,
  );

  return {
    commands: [{ type: UpdatePlatformConfigCommand.TYPE, handler: updatePlatformConfig }],
    queries: [{ type: ListPlatformsQuery.TYPE, handler: listPlatforms }],
  };
}
