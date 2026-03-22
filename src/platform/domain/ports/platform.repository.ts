import type { AppContext } from "../../../utils/kernel/context.js";
import type { Platform } from "../platform/platform.aggregate.js";

export interface IPlatformRepository {
  save(ctx: AppContext, platform: Platform): Promise<void>;
  findById(ctx: AppContext, platformId: string): Promise<Platform | null>;
  findByApiKeyId(ctx: AppContext, apiKeyId: string): Promise<Platform | null>;
  existsByApiKeyId(ctx: AppContext, apiKeyId: string): Promise<boolean>;
}
