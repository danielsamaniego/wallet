import type { AppContext } from "../../../utils/kernel/context.js";
import type { Movement } from "../movement/movement.entity.js";

export interface IMovementRepository {
  save(ctx: AppContext, movement: Movement): Promise<void>;
}
