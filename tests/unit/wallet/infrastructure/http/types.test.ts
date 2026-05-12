import { describe, it, expect, vi } from "vitest";
import { buildMutationDeps } from "@/wallet/infrastructure/adapters/inbound/http/types.js";
import type { Dependencies } from "@/wiring.js";
import type { Config } from "@/config.js";
import type { ICommandBus, IQueryBus } from "@/utils/application/cqrs.js";
import type { IResultSubscriber } from "@/wallet/domain/ports/result.subscriber.js";

const baseConfig: Config = {
  databaseUrl: "postgresql://localhost",
  directUrl: "postgresql://localhost",
  httpPort: 3000,
  logLevel: "info",
  cronSecret: "",
  asyncProcessingEnabled: false,
};

function baseDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  const commandBus: ICommandBus = { dispatch: vi.fn() };
  const queryBus: IQueryBus = { dispatch: vi.fn() };
  return {
    config: baseConfig,
    prisma: {} as Dependencies["prisma"],
    idGen: { newId: vi.fn(() => "id") },
    logger: {} as Dependencies["logger"],
    idempotencyStore: {} as Dependencies["idempotencyStore"],
    commandBus,
    queryBus,
    ...overrides,
  };
}

describe("buildMutationDeps", () => {
  describe("Given Dependencies without a resultSubscriber (sync-only deployment)", () => {
    it("Then asyncDispatch is omitted so the handler stays on the sync path", () => {
      const out = buildMutationDeps(baseDeps());
      expect(out.asyncDispatch).toBeUndefined();
      expect(out.commandBus).toBeDefined();
      expect(out.queryBus).toBeDefined();
    });
  });

  describe("Given a resultSubscriber but no asyncPipeline (rollout flag flipped before publisher env vars landed)", () => {
    it("Then asyncDispatch is still omitted — both ends of the pipeline must be wired together or the handler falls back to sync", () => {
      const subscriber: IResultSubscriber = { waitFor: vi.fn() };
      const out = buildMutationDeps(
        baseDeps({
          resultSubscriber: subscriber,
          config: { ...baseConfig, asyncProcessingEnabled: true },
        }),
      );
      expect(out.asyncDispatch).toBeUndefined();
    });
  });

  describe("Given a resultSubscriber AND asyncPipeline both wired", () => {
    it("Then asyncDispatch carries the subscriber and handlerWaitMs from config", () => {
      const subscriber: IResultSubscriber = { waitFor: vi.fn() };
      const out = buildMutationDeps(
        baseDeps({
          resultSubscriber: subscriber,
          config: {
            ...baseConfig,
            asyncProcessingEnabled: true,
            asyncPipeline: {
              qstashUrl: "https://q",
              qstashToken: "tk",
              queueName: "q",
              workerUrl: "https://w",
              handlerWaitMs: 2500,
            },
          },
        }),
      );
      expect(out.asyncDispatch).toBeDefined();
      expect(out.asyncDispatch?.resultSubscriber).toBe(subscriber);
      expect(out.asyncDispatch?.handlerWaitMs).toBe(2500);
    });
  });
});
