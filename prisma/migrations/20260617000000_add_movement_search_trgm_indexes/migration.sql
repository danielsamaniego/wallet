-- R5 free-text movement search performance.
--
-- The /v1/movements/search endpoint matches reference/reason with a
-- case-insensitive substring (Prisma `contains` -> ILIKE '%q%'). Without a
-- trigram index that degrades to a sequential scan, which would compete with
-- the write path on the primary. pg_trgm + a GIN index let Postgres serve the
-- ILIKE from the index instead.
--
-- These indexes are intentionally NOT declared in schema.prisma: Prisma cannot
-- express a `gin_trgm_ops` operator-class index without preview features, and
-- it leaves such unrepresentable indexes untouched on future migrations.
--
-- NOTE: on a large existing `transactions` table, building these inside the
-- migration transaction takes a write lock for the duration. If the table is
-- already large at deploy time, build them out-of-band with
-- `CREATE INDEX CONCURRENTLY` (cannot run inside a transaction) instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "transactions_reference_trgm_idx"
  ON "transactions" USING gin ("reference" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "movements_reason_trgm_idx"
  ON "movements" USING gin ("reason" gin_trgm_ops);
