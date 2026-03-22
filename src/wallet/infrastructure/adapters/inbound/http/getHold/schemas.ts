import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ holdId: z.string().min(1).max(255) });

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  id: z.string(),
  wallet_id: z.string(),
  amount_cents: z.union([z.number(), z.string()]),
  status: z.string(),
  reference: z.string().nullable(),
  expires_at: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
