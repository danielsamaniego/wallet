import type { AppContext } from "../domain/kernel/context.js";

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
