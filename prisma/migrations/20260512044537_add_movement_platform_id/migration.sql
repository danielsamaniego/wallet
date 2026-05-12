-- AlterTable: add nullable column.
-- Kept NULLABLE because legacy rows without transactions (pre-Phase-2B orphans)
-- cannot be backfilled deterministically. The application readstore falls back
-- to the transactional path (transactions.some.wallet.platformId) when
-- platform_id is null. All movements created from Phase 2B onward MUST set it.
ALTER TABLE "movements" ADD COLUMN "platform_id" TEXT;

-- The append-only trigger on `movements` (defined in prisma/immutable_ledger.sql)
-- blocks UPDATE. The function it calls is created with CREATE OR REPLACE here
-- so this migration is self-contained: it works against a fresh database (no
-- trigger present yet) AND against an existing one (trigger present from a
-- prior immutable_ledger.sql run). We drop the trigger, perform the one-time
-- backfill, then restore the trigger. immutable_ledger.sql remains idempotent
-- and can re-run after migrate-deploy without conflict.
CREATE OR REPLACE FUNCTION prevent_immutable_modify()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % operation not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS movements_immutable ON movements;

-- Backfill from transactions.wallet.platformId.
-- For movements that already have transactions (the vast majority of legacy
-- rows are 'posted' with a transaction pair), this fills the column. Movements
-- with no transactions (rare data-integrity artifacts) remain NULL and are
-- naturally unreachable through the public read API; the readstore falls back
-- to the transactional path for any row where platform_id IS NULL.
UPDATE "movements" m
   SET "platform_id" = sub.platform_id
  FROM (
    SELECT DISTINCT ON (t."movement_id")
      t."movement_id"   AS movement_id,
      w."platform_id"   AS platform_id
    FROM "transactions" t
    JOIN "wallets"      w ON w."id" = t."wallet_id"
    ORDER BY t."movement_id", t."created_at" ASC
  ) sub
 WHERE m."id" = sub.movement_id
   AND m."platform_id" IS NULL;

-- Restore the immutable trigger so future UPDATEs are blocked again.
CREATE TRIGGER movements_immutable
  BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_modify();

-- CreateIndex: enables the platform-scoped GET /v1/movements/{id} filter
-- to hit a direct btree without joining through transactions+wallets.
CREATE INDEX "movements_platform_id_status_created_at_idx"
  ON "movements"("platform_id", "status", "created_at");
