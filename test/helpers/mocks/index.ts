export { mock, mockReset, mockDeep, mockClear } from "vitest-mock-extended";

import { vi } from "vitest";
import type { IIDGenerator } from "@/utils/application/id.generator.js";
import type { ILogger } from "@/utils/kernel/observability/logger.port.js";
import type { ITransactionManager } from "@/utils/application/transaction.manager.js";
import type { LockRunner } from "@/utils/application/lock.runner.js";
import type { AppContext } from "@/utils/kernel/context.js";

/**
 * Creates a mock IIDGenerator that returns sequential IDs.
 * Pass a fixed list of IDs or let it generate "test-id-1", "test-id-2", etc.
 */
export function createMockIDGenerator(ids?: string[]): IIDGenerator & { reset: () => void } {
  let index = 0;
  const generator = {
    newId: vi.fn(() => {
      if (ids) {
        if (index >= ids.length) throw new Error(`Mock ID generator exhausted: requested ID #${index + 1} but only ${ids.length} IDs provided`);
        return ids[index++]!;
      }
      return `test-id-${++index}`;
    }),
    reset() {
      index = 0;
    },
  };
  return generator;
}

/**
 * Creates a mock ILogger where all methods are no-ops.
 * `with()` returns the same mock instance (chainable).
 */
export function createMockLogger(): ILogger {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    with: vi.fn(() => logger),
    addCanonicalMeta: vi.fn(),
    incrementCanonical: vi.fn(),
    decrementCanonical: vi.fn(),
    dispatchCanonicalDebug: vi.fn(),
    dispatchCanonicalInfo: vi.fn(),
    dispatchCanonicalWarn: vi.fn(),
    dispatchCanonicalError: vi.fn(),
  };
  return logger;
}

/**
 * Creates a mock ITransactionManager that executes the callback immediately (pass-through).
 * The same ctx is passed to fn — no opCtx enrichment (unit tests don't need real transactions).
 */
export function createMockTransactionManager(): ITransactionManager {
  return {
    run: vi.fn((_ctx: AppContext, fn: (txCtx: AppContext) => Promise<unknown>) => fn(_ctx)) as ITransactionManager["run"],
  };
}

/**
 * Creates a mock LockRunner that executes the callback immediately (pass-through).
 * Unit tests exercise the use case logic without involving a real lock backend;
 * the runner's behavior under contention / backend failure is covered by its
 * own unit tests.
 */
export function createMockLockRunner(): LockRunner {
  return {
    run: vi.fn((_ctx: AppContext, _keys: readonly string[], fn: () => Promise<unknown>) => fn()),
  } as unknown as LockRunner;
}
