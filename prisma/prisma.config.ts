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
const directUrl =
  process.env.DIRECT_URL ?? databaseUrl;

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: databaseUrl,
  },
  migrate: {
    async url() {
      return directUrl;
    },
  },
});
