import type { ICommandBus, IQueryBus } from "../../../../../utils/application/cqrs.js";
import type { Dependencies } from "../../../../../wiring.js";
import type { IResultSubscriber } from "../../../../domain/ports/result.subscriber.js";

/**
 * Shared deps for the six mutating HTTP handlers (`deposit`,
 * `withdraw`, `charge`, `adjustBalance`, `transfer`, `captureHold`).
 *
 * `asyncDispatch` is present iff `config.asyncProcessingEnabled` is
 * true AND the pub/sub subscriber is wired AND the QStash publisher
 * pipeline is registered on the bus. When present, the handler tries
 * the async path; when absent, it stays on today's inline sync
 * dispatch. The wiring layer is the only place that decides — the
 * handler never re-reads env or config.
 *
 * `queryBus` is needed by `captureHold` to pre-resolve the hold's
 * `wallet_id` for the worker's lock key (the worker's hydrator reads
 * a pre-resolved `walletId` from `queue_payload`, avoiding a
 * synchronous DB lookup on every queued message). The other five
 * mutating handlers do not consult it but accept the same deps shape
 * for consistency.
 */
export interface MutationHandlerDeps {
  commandBus: ICommandBus;
  queryBus: IQueryBus;
  asyncDispatch?: {
    resultSubscriber: IResultSubscriber;
    handlerWaitMs: number;
  };
}

/**
 * Projects the top-level `Dependencies` down to `MutationHandlerDeps`.
 * `asyncDispatch` is populated only when both the subscriber is wired
 * (i.e. `WALLET_ASYNC_PROCESSING_ENABLED=true` + TCP Redis backend) AND
 * the publisher pipeline is configured (`config.asyncPipeline` set).
 * Either missing → handler stays on the sync path even if the operator
 * flipped the rollout flag before the publisher env vars landed.
 */
export function buildMutationDeps(deps: Dependencies): MutationHandlerDeps {
  return {
    commandBus: deps.commandBus,
    queryBus: deps.queryBus,
    ...(deps.resultSubscriber && deps.config.asyncPipeline
      ? {
          asyncDispatch: {
            resultSubscriber: deps.resultSubscriber,
            handlerWaitMs: deps.config.asyncPipeline.handlerWaitMs,
          },
        }
      : {}),
  };
}
