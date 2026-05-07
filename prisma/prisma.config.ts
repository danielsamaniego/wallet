// Prisma CLI config.
//
// Consumed by `prisma migrate dev` locally and by `prisma migrate deploy`
// in CI (.github/workflows/migrate.yml). The workflow fires automatically
// on push to `main` whenever any file under `prisma/**` changes, and can
// be dispatched manually from the GitHub Actions UI.
import path from "node:path";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet";
const directUrl = process.env.DIRECT_URL ?? databaseUrl;

/**
 * Production sets `statement_timeout` and `idle_in_transaction_session_timeout`
 * on the runtime role to bound how long a query can keep running on Postgres
 * after a serverless lambda dies (the last-line defence against ghost
 * executions). Migrations run as the same role and would inherit those caps —
 * which can be fatal for `CREATE INDEX` on large tables, lengthy backfills, or
 * any DDL that legitimately exceeds 20 s.
 *
 * Migration sessions therefore disable both caps via the `options` query
 * parameter (libpq passes `-c statement_timeout=0 -c idle_in_transaction_session_timeout=0`
 * directly to the server, scoped to the connection — no global change). The
 * runtime role's defaults remain in force for the wallet API and cron jobs.
 */
function withMigrationOverrides(url: string): string {
  const overrides = "-c statement_timeout=0 -c idle_in_transaction_session_timeout=0";
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}options=${encodeURIComponent(overrides)}`;
}

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: databaseUrl,
  },
  migrate: {
    async url() {
      return withMigrationOverrides(directUrl);
    },
  },
});
