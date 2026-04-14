import type { AppContext } from "../kernel/context.js";
import type {
  ICommand,
  ICommandHandler,
  IQuery,
  IQueryHandler,
  ICommandBus,
  IQueryBus,
  BusMiddleware,
} from "../application/cqrs.js";

// ────────────────────────────────────────────
// CommandBus — dispatches commands to their
// registered handler through a middleware pipeline.
// ────────────────────────────────────────────

export class CommandBus implements ICommandBus {
  private readonly handlers = new Map<string, ICommandHandler<any, any>>();
  private readonly middlewares: BusMiddleware[] = [];

  register<T>(type: string, handler: ICommandHandler<ICommand<T>, T>): void {
    this.handlers.set(type, handler);
  }

  use(mw: BusMiddleware): void {
    this.middlewares.push(mw);
  }

  async dispatch<T>(ctx: AppContext, cmd: ICommand<T>): Promise<T> {
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      throw new Error(`CommandBus: no handler registered for ${cmd.type}`);
    }

    const execute = () => handler.handle(ctx, cmd) as Promise<T>;

    // Build pipeline: mw1( mw2( ... execute() ) )
    const pipeline = this.middlewares.reduceRight<() => Promise<T>>(
      (next, mw) => () => mw(ctx, cmd, next) as Promise<T>,
      execute,
    );

    return pipeline();
  }
}

// ────────────────────────────────────────────
// QueryBus — dispatches queries to their
// registered handler through a middleware pipeline.
// ────────────────────────────────────────────

export class QueryBus implements IQueryBus {
  private readonly handlers = new Map<string, IQueryHandler<any, any>>();
  private readonly middlewares: BusMiddleware[] = [];

  register<T>(type: string, handler: IQueryHandler<IQuery<T>, T>): void {
    this.handlers.set(type, handler);
  }

  use(mw: BusMiddleware): void {
    this.middlewares.push(mw);
  }

  async dispatch<T>(ctx: AppContext, query: IQuery<T>): Promise<T> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`QueryBus: no handler registered for ${query.type}`);
    }

    const execute = () => handler.handle(ctx, query) as Promise<T>;

    const pipeline = this.middlewares.reduceRight<() => Promise<T>>(
      (next, mw) => () => mw(ctx, query, next) as Promise<T>,
      execute,
    );

    return pipeline();
  }
}
