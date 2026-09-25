import { z } from "zod";
export const ErrorClassificationSchema = z.enum(["quota", "rate-limit", "auth", "crash"]);
export const LimitInfoSchema = z.object({
    limited: z.boolean(),
    errorType: ErrorClassificationSchema.optional(),
    reason: z.string().optional(),
    resetAt: z.string().optional(),
});
//# sourceMappingURL=limit-info.js.map