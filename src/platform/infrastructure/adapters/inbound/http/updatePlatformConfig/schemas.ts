import { z } from "zod";

export const BodySchema = z.object({
  allow_negative_balance: z.boolean().optional(),
  /**
   * Number of shards for the platform's system wallets. Can only be increased
   * (domain-enforced); bounded at [1, 1024]. When increased, new shards are
   * eagerly materialised for every currency already in use by this platform.
   * See docs/architecture/systemPatterns.md § "System Wallet Sharding".
   */
  system_wallet_shard_count: z.number().int().min(1).max(1024).optional(),
});

export const ResponseSchema = z.object({
  platform_id: z.string(),
});
