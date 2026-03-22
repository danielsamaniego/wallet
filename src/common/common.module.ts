import type { ModuleHandlers, SharedInfra } from "../wiring.js";

// Use cases
import { CleanupIdempotencyUseCase } from "./idempotency/application/command/cleanupIdempotency/usecase.js";

// Commands (for bus registration)
import { CleanupIdempotencyCommand } from "./idempotency/application/command/cleanupIdempotency/command.js";

export function wire({ idempotencyStore, logger }: SharedInfra): ModuleHandlers {
  const cleanupIdempotency = new CleanupIdempotencyUseCase(idempotencyStore, logger);

  return {
    commands: [
      { type: CleanupIdempotencyCommand.TYPE, handler: cleanupIdempotency },
    ],
  };
}
