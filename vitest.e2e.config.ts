import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    globalSetup: ["tests/e2e/setup/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": "./src",
      "@test": "./test",
    },
  },
});
