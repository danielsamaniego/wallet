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

export function wire({ prisma, logger }: SharedInfra): ModuleHandlers {
  const platformRepo = new PrismaPlatformRepo(prisma, logger);
  const platformReadStore = new PrismaPlatformReadStore(prisma, logger);

  const listPlatforms = new ListPlatformsUseCase(platformReadStore, logger);
  const updatePlatformConfig = new UpdatePlatformConfigUseCase(platformRepo, logger);

  return {
    commands: [{ type: UpdatePlatformConfigCommand.TYPE, handler: updatePlatformConfig }],
    queries: [{ type: ListPlatformsQuery.TYPE, handler: listPlatforms }],
  };
}
