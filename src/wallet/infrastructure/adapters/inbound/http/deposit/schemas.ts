import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

export const BodySchema = z.object({
  amount_minor: z.number().int().positive(),
  reference: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  transaction_id: z.string(),
  movement_id: z.string(),
});
