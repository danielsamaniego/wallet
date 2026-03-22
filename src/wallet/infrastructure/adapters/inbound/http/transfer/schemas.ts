import { z } from "zod";

// ── Request ─────────────────────────────────────────────────────────────────

export const BodySchema = z.object({
  source_wallet_id: z.string().min(1).max(255),
  target_wallet_id: z.string().min(1).max(255),
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
});

// ── Response ────────────────────────────────────────────────────────────────

export const ResponseSchema = z.object({
  source_transaction_id: z.string(),
  target_transaction_id: z.string(),
  movement_id: z.string(),
});
