import { uuidv7 } from "uuidv7";

import type { IDGenerator } from "../idGenerator.js";

/**
 * UUIDV7Generator implements IDGenerator using UUID v7 (RFC 9562, time-ordered).
 * All entity IDs in the system use UUID v7 (time-ordered, sortable).
 */
export class UUIDV7Generator implements IDGenerator {
  newId(): string {
    return uuidv7();
  }
}
