import { describe, it, expect, vi } from "vitest";
import { CommandBus, QueryBus } from "@/utils/infrastructure/cqrs.js";
import { ICommand, IQuery } from "@/utils/application/cqrs.js";
import type { AppContext } from "@/utils/kernel/context.js";
import { CanonicalAccumulator } from "@/utils/kernel/observability/canonical.js";

// ── Test doubles ───────────────────────────────────────────────────────

class TestCommand extends ICommand<string> {
  constructor(readonly payload: string) {
    super("TestCommand");
  }
}

class TestQuery extends IQuery<number> {
  constructor(readonly filter: string) {
    super("TestQuery");
  }
}

function fakeCtx(): AppContext {
  return {
    trackingId: "trk-1",
    startTs: Date.now(),
    canonical: new CanonicalAccumulator(),
  };
}

// ── CommandBus ─────────────────────────────────────────────────────────

describe("CommandBus", () => {
  describe("register and dispatch", () => {
    it("Given a registered handler, When dispatch is called, Then handler executes and returns result", async () => {
      const bus = new CommandBus();
      bus.register("TestCommand", {
        handle: async (_ctx, cmd: TestCommand) => `handled:${cmd.payload}`,
      });

      const result = await bus.dispatch(fakeCtx(), new TestCommand("hello"));
      expect(result).toBe("handled:hello");
    });

    it("Given no handler registered, When dispatch is called, Then throws error", async () => {
      const bus = new CommandBus();
      await expect(bus.dispatch(fakeCtx(), new TestCommand("x"))).rejects.toThrow(
        "CommandBus: no handler registered for TestCommand",
      );
    });
  });

  describe("middleware", () => {
    it("Given a middleware, When dispatch is called, Then middleware wraps handler execution", async () => {
      const bus = new CommandBus();
      const order: string[] = [];

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw:before");
        const result = await next();
        order.push("mw:after");
        return result;
      });

      bus.register("TestCommand", {
        handle: async (_ctx, cmd: TestCommand) => {
          order.push("handler");
          return `done:${cmd.payload}`;
        },
      });

      const result = await bus.dispatch(fakeCtx(), new TestCommand("go"));
      expect(result).toBe("done:go");
      expect(order).toEqual(["mw:before", "handler", "mw:after"]);
    });

    it("Given multiple middlewares, When dispatch is called, Then they execute in registration order", async () => {
      const bus = new CommandBus();
      const order: string[] = [];

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw1:before");
        const r = await next();
        order.push("mw1:after");
        return r;
      });

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw2:before");
        const r = await next();
        order.push("mw2:after");
        return r;
      });

      bus.register("TestCommand", {
        handle: async () => {
          order.push("handler");
          return "ok";
        },
      });

      await bus.dispatch(fakeCtx(), new TestCommand("x"));
      expect(order).toEqual(["mw1:before", "mw2:before", "handler", "mw2:after", "mw1:after"]);
    });
  });
});

// ── QueryBus ──────────────────────────────────────────────────────────

describe("QueryBus", () => {
  describe("register and dispatch", () => {
    it("Given a registered handler, When dispatch is called, Then handler executes and returns result", async () => {
      const bus = new QueryBus();
      bus.register("TestQuery", {
        handle: async (_ctx, query: TestQuery) => (query.filter === "all" ? 42 : 0),
      });

      const result = await bus.dispatch(fakeCtx(), new TestQuery("all"));
      expect(result).toBe(42);
    });

    it("Given no handler registered, When dispatch is called, Then throws error", async () => {
      const bus = new QueryBus();
      await expect(bus.dispatch(fakeCtx(), new TestQuery("x"))).rejects.toThrow(
        "QueryBus: no handler registered for TestQuery",
      );
    });
  });

  describe("middleware", () => {
    it("Given a middleware, When dispatch is called, Then middleware wraps handler execution", async () => {
      const bus = new QueryBus();
      const order: string[] = [];

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw:before");
        const result = await next();
        order.push("mw:after");
        return result;
      });

      bus.register("TestQuery", {
        handle: async () => {
          order.push("handler");
          return 99;
        },
      });

      const result = await bus.dispatch(fakeCtx(), new TestQuery("any"));
      expect(result).toBe(99);
      expect(order).toEqual(["mw:before", "handler", "mw:after"]);
    });

    it("Given multiple middlewares, When dispatch is called, Then they execute in registration order", async () => {
      const bus = new QueryBus();
      const order: string[] = [];

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw1:before");
        const r = await next();
        order.push("mw1:after");
        return r;
      });

      bus.use(async (_ctx, _msg, next) => {
        order.push("mw2:before");
        const r = await next();
        order.push("mw2:after");
        return r;
      });

      bus.register("TestQuery", {
        handle: async () => {
          order.push("handler");
          return 1;
        },
      });

      await bus.dispatch(fakeCtx(), new TestQuery("x"));
      expect(order).toEqual(["mw1:before", "mw2:before", "handler", "mw2:after", "mw1:after"]);
    });
  });
});
