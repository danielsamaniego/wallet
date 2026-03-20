import { z } from "zod";

export const BodySchema = z.object({
  wallet_id: z.string().min(1).max(255),
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
  expires_at: z.number().int().positive().optional(),
});
