import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "schema.prisma"),
  migrate: {
    async url() {
      return process.env.DATABASE_URL ?? "postgresql://wallet:wallet@localhost:5432/wallet";
    },
  },
});
