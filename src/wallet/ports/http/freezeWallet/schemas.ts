import { z } from "zod";

export const ParamSchema = z.object({ walletId: z.string().min(1).max(255) });
