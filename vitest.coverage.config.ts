import { defineConfig } from "vitest/config";

/**
 * Combined config for full coverage measurement.
 * Runs BOTH unit + e2e tests sequentially and merges coverage.
 * Usage: pnpm test:coverage
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/e2e/**/*.e2e.test.ts",
    ],
    globalSetup: ["tests/e2e/setup/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Pure interfaces — compile to nothing, 0 executable code
        "src/**/ports/**",
        "src/**/domain/ports/**",
        "src/utils/application/id.generator.ts",
        "src/utils/application/transaction.manager.ts",
        "src/utils/kernel/observability/logger.port.ts",
        // Config/wiring — tested implicitly via e2e setup
        "src/index.ts",
        "src/wiring.ts",
        "src/config.ts",
        // DTO types — no runtime logic
        "src/**/dto.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": "./src",
      "@test": "./test",
    },
  },
});
