import { z } from "zod";
export declare const ErrorClassificationSchema: z.ZodEnum<{
    quota: "quota";
    "rate-limit": "rate-limit";
    auth: "auth";
    crash: "crash";
}>;
export type ErrorClassification = z.infer<typeof ErrorClassificationSchema>;
export declare const LimitInfoSchema: z.ZodObject<{
    limited: z.ZodBoolean;
    errorType: z.ZodOptional<z.ZodEnum<{
        quota: "quota";
        "rate-limit": "rate-limit";
        auth: "auth";
        crash: "crash";
    }>>;
    reason: z.ZodOptional<z.ZodString>;
    resetAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type LimitInfo = z.infer<typeof LimitInfoSchema>;
