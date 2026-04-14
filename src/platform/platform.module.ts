import type { ModuleHandlers, SharedInfra } from "../wiring.js";
// Queries (for bus registration)
import { ListPlatformsQuery } from "./application/query/listPlatforms/query.js";

// Use cases
import { ListPlatformsUseCase } from "./application/query/listPlatforms/usecase.js";
// Repos
import { PrismaPlatformReadStore } from "./infrastructure/adapters/outbound/prisma/platform.readstore.js";

export function wire({ prisma, logger }: SharedInfra): ModuleHandlers {
  const platformReadStore = new PrismaPlatformReadStore(prisma, logger);
  const listPlatforms = new ListPlatformsUseCase(platformReadStore, logger);

  return {
    queries: [{ type: ListPlatformsQuery.TYPE, handler: listPlatforms }],
  };
}
