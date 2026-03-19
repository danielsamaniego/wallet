import { z } from "zod";

const IdParam = z.string().min(1).max(255);

/**
 * Validates and extracts a path parameter. Returns the parsed value
 * or null if invalid. Keeps handlers clean and consistent.
 */
export function parsePathId(raw: string | undefined): string | null {
  const result = IdParam.safeParse(raw);
  return result.success ? result.data : null;
}
