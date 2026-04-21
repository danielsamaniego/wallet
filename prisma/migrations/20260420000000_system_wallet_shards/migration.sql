-- System Wallet Sharding
-- See docs/architecture/systemPatterns.md § "System Wallet Sharding" for design.
--
-- The hot-row problem: concurrent user mutations on the same (platform, currency)
-- all hit the single system wallet row as counterparty. Under SERIALIZABLE isolation
-- this serializes them and produces 409 VERSION_CONFLICT at scale.
--
-- Fix: each (platform, currency) system wallet becomes N physical rows (shard 0..N-1).
-- Every mutating use case hashes the user walletId to a shard and writes to that one.
-- User wallets are NOT sharded (they have a single owner, no cross-user contention).
--
-- Backward compatible: existing ledger_entries / transactions still reference wallet.id.
-- The pre-existing system wallet becomes shard 0. Additional shards are created lazily
-- by the app on first use (ensureSystemWalletShards with INSERT … ON CONFLICT DO NOTHING).

-- 1. Platform: configurable shard count (per-platform, dynamic, only-increase enforced by domain).
ALTER TABLE "platforms"
  ADD COLUMN "system_wallet_shard_count" INTEGER NOT NULL DEFAULT 32;

ALTER TABLE "platforms"
  ADD CONSTRAINT "ck_platform_shard_count_bounds"
  CHECK ("system_wallet_shard_count" BETWEEN 1 AND 1024);

-- 2. Wallet: shard index. NOT NULL DEFAULT 0 so:
--    - User wallets carry shard_index=0 (they are their own shard 0; cosmetic but uniform).
--    - Existing system wallets are backfilled to 0 by the DEFAULT → they become shard 0.
--    - The composite unique below works without dealing with NULL-distinct semantics.
ALTER TABLE "wallets"
  ADD COLUMN "shard_index" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "wallets"
  ADD CONSTRAINT "ck_wallet_shard_index_non_negative"
  CHECK ("shard_index" >= 0);

-- 3. Replace the wallet identity unique.
--    Old:  (owner_id, platform_id, currency_code) — only allowed one system wallet per pair.
--    New:  (owner_id, platform_id, currency_code, shard_index) — allows N system shards.
--    For user wallets (shard_index always 0), behaviour is identical.
DROP INDEX IF EXISTS "wallets_owner_id_platform_id_currency_code_key";

CREATE UNIQUE INDEX "wallets_owner_id_platform_id_currency_code_shard_index_key"
  ON "wallets" ("owner_id", "platform_id", "currency_code", "shard_index");

-- 4. Composite index to accelerate the aggregate sum (sumSystemWalletBalance).
CREATE INDEX IF NOT EXISTS "wallets_platform_id_currency_code_is_system_idx"
  ON "wallets" ("platform_id", "currency_code", "is_system");
