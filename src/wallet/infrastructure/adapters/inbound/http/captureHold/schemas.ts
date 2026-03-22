import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ holdId: z.string().min(1).max(255) });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  transaction_id: z.string(),
  movement_id: z.string(),
});
