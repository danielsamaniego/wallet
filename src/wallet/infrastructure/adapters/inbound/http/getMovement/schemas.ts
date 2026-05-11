import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ movementId: z.string().min(1).max(255) });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  failed_reason: z.string().nullable(),
  created_at: z.number(),
});
