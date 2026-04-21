import type { AppContext } from "../../../utils/kernel/context.js";
import type { Wallet } from "../wallet/wallet.aggregate.js";

export interface IWalletRepository {
  save(ctx: AppContext, wallet: Wallet): Promise<void>;
  /**
   * Atomically adjust a specific system wallet shard's balance by a delta.
   * Single `UPDATE ... RETURNING` statement keyed by the 4-tuple
   * `(SYSTEM, platform_id, currency_code, shard_index)`. Returns the shard's
   * id and the post-increment balance — callers use these directly to build
   * the ledger entry without a separate read (any prior SELECT on the shard
   * would create a read-write dependency that PostgreSQL SERIALIZABLE would
   * abort under cross-wallet concurrency).
   *
   * Throws `ErrSystemWalletNotFound` if the shard does not exist; callers
   * should have materialised it via `ensureSystemWalletShards` earlier in
   * the request lifetime (createWallet or UpdatePlatformConfig expansion).
   */
  adjustSystemShardBalance(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
    shardIndex: number,
    deltaMinor: bigint,
    now: number,
  ): Promise<{ walletId: string; cachedBalanceMinor: bigint }>;
  findById(ctx: AppContext, walletId: string): Promise<Wallet | null>;
  findByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<Wallet | null>;
  /**
   * Idempotently inserts the shards `0..shardCount-1` for a (platform,
   * currency) pair that are not already present. Safe to call concurrently:
   * uses `INSERT ... ON CONFLICT DO NOTHING`. Callers typically invoke this
   * from `createWallet` (first op per currency), `UpdatePlatformConfig` (when
   * the count is increased), or lazily from a mutation use case if a shard
   * lookup returns null.
   */
  ensureSystemWalletShards(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
    shardCount: number,
    now: number,
  ): Promise<void>;
  /**
   * Aggregate balance across all shards of the system wallet for a (platform,
   * currency) pair. This is the transparent "logical balance" of the system
   * wallet that reports, dashboards, and reconciliation scripts should read.
   */
  sumSystemWalletBalance(
    ctx: AppContext,
    platformId: string,
    currencyCode: string,
  ): Promise<{ cachedBalanceMinor: bigint; shardCount: number }>;
  /**
   * Distinct currency codes for which a platform has one or more system-wallet
   * shards materialised. Used by `UpdatePlatformConfig` when the shard count
   * is increased, so the new shards can be eagerly created only for currencies
   * already in use (instead of every supported currency blindly).
   */
  listSystemWalletCurrencies(ctx: AppContext, platformId: string): Promise<string[]>;
  existsByOwner(
    ctx: AppContext,
    ownerId: string,
    platformId: string,
    currencyCode: string,
  ): Promise<boolean>;
}
