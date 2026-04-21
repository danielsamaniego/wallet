import { ICommand } from "../../../../utils/application/cqrs.js";

export interface UpdatePlatformConfigResult {
  platformId: string;
}

export class UpdatePlatformConfigCommand extends ICommand<UpdatePlatformConfigResult> {
  static readonly TYPE = "UpdatePlatformConfig";
  constructor(
    public readonly platformId: string,
    /** If provided, update the platform's `allow_negative_balance` flag. */
    public readonly allowNegativeBalance: boolean | undefined,
    /**
     * If provided, update the platform's `system_wallet_shard_count`. The
     * domain enforces "only increase" + bounds. After update, the use case
     * eagerly materialises the new shards for every currency already in use.
     */
    public readonly systemWalletShardCount: number | undefined,
  ) {
    super(UpdatePlatformConfigCommand.TYPE);
  }
}
