import { uuidv7 } from "uuidv7";

import type { IIDGenerator } from "../../application/id.generator.js";

/**
 * UUIDV7Generator implements IIDGenerator using UUID v7 (RFC 9562, time-ordered).
 * All entity IDs in the system use UUID v7 (time-ordered, sortable).
 */
export class UUIDV7Generator implements IIDGenerator {
  newId(): string {
    return uuidv7();
  }
}
