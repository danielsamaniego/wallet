import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/dto.ts",
        "src/index.ts",
        "src/wiring.ts",
        "src/config.ts",
        "src/**/ports/**",
        "src/**/*.module.ts",
        "src/utils/application/id.generator.ts",
        "src/utils/application/transaction.manager.ts",
        "src/utils/kernel/observability/logger.port.ts",
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
