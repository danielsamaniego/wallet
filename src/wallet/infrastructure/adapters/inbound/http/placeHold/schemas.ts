import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const BodySchema = z.object({
  wallet_id: z.string().min(1).max(255),
  amount_minor: z.number().int().positive(),
  reference: z.string().max(500).optional(),
  expires_at: z.number().int().positive().optional(),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  hold_id: z.string(),
});
