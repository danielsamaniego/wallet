import type { AppContext } from "../kernel/context.js";

// ────────────────────────────────────────────
// Marker interfaces — the phantom `_resultType`
// lets TypeScript infer TResult from the command/query
// without existing at runtime.
// ────────────────────────────────────────────

export abstract class ICommand<TResult = void> {
  declare readonly _resultType: TResult;
}

export abstract class IQuery<TResult = void> {
  declare readonly _resultType: TResult;
}

// ────────────────────────────────────────────
// Handler contracts
// ────────────────────────────────────────────

export interface ICommandHandler<
  TCommand extends ICommand<TResult>,
  TResult,
> {
  handle(ctx: AppContext, cmd: TCommand): Promise<TResult>;
}

export interface IQueryHandler<
  TQuery extends IQuery<TResult>,
  TResult,
> {
  handle(ctx: AppContext, query: TQuery): Promise<TResult>;
}

// ────────────────────────────────────────────
// Bus middleware — intercepts dispatch calls
// for cross-cutting concerns (logging, metrics, etc.)
// ────────────────────────────────────────────

export type BusMiddleware = (
  ctx: AppContext,
  message: ICommand<unknown> | IQuery<unknown>,
  next: () => Promise<unknown>,
) => Promise<unknown>;

// ────────────────────────────────────────────
// Bus contracts — central dispatch point for
// commands and queries through a middleware pipeline.
// ────────────────────────────────────────────

export interface ICommandBus {
  dispatch<T>(ctx: AppContext, cmd: ICommand<T>): Promise<T>;
}

export interface IQueryBus {
  dispatch<T>(ctx: AppContext, query: IQuery<T>): Promise<T>;
}
