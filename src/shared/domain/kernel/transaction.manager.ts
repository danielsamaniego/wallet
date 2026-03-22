import type { AppContext } from "./context.js";

/**
 * TransactionManager opens a transactional scope and passes an enriched
 * AppContext (with opCtx populated) to the callback. Repositories inspect
 * ctx.opCtx to decide whether to run inside the active transaction or
 * against the default database client.
 */
export interface ITransactionManager {
  run<T>(ctx: AppContext, fn: (txCtx: AppContext) => Promise<T>): Promise<T>;
}
