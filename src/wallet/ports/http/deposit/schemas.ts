import { z } from "zod";

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });

export const BodySchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().max(500).optional(),
});
