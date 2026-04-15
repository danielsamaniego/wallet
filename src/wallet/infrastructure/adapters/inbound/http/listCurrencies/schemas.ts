import { z } from "zod";

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  currencies: z.array(
    z.object({
      code: z.string(),
      minor_unit: z.number(),
    }),
  ),
});
