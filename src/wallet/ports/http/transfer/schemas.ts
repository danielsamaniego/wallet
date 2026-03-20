import { z } from "zod";

export const BodySchema = z.object({
  source_wallet_id: z.string().min(1).max(255),
  target_wallet_id: z.string().min(1).max(255),
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
});
