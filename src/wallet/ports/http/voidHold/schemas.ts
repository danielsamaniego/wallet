import { z } from "zod";

export const ParamSchema = z.object({ holdId: z.string().min(1).max(255) });
