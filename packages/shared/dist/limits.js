import { z } from "zod";
import { ProviderSchema } from "./agent.js";
import { EffortSchema } from "./models.js";
import { ErrorClassificationSchema, LimitInfoSchema } from "./limit-info.js";
export { ErrorClassificationSchema, LimitInfoSchema };
export const WindowLimitSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("not reported"),
    }),
    z.object({
        status: z.literal("reported"),
        percentLeft: z.number().min(0).max(100),
        usedPercent: z.number().min(0).max(100),
        resetAt: z.string().optional(),
        windowMinutes: z.number().optional(),
    }),
]);
export const ProviderModelLimitsSchema = z.object({
    provider: ProviderSchema,
    model: z.string(),
    fiveHour: WindowLimitSchema,
    weekly: WindowLimitSchema,
    updatedAt: z.string(),
});
export const ProviderLimitsEntrySchema = z.object({
    limit: LimitInfoSchema,
    models: z.record(z.string(), ProviderModelLimitsSchema),
});
export const LimitsReportSchema = z.object({
    providers: z.record(ProviderSchema, ProviderLimitsEntrySchema),
    updatedAt: z.string(),
});
export const TokenUsageBucketSchema = z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    runs: z.number().int().min(0),
});
export const UsageAggregateSchema = z.object({
    session: TokenUsageBucketSchema,
    today: TokenUsageBucketSchema,
    last7Days: TokenUsageBucketSchema,
});
export const UsageReportSchema = z.object({
    agents: z.record(z.string(), UsageAggregateSchema),
    providers: z.record(ProviderSchema, UsageAggregateSchema),
    updatedAt: z.string(),
});
export const SwitchAgentPayloadSchema = z.object({
    provider: ProviderSchema.nullable().optional(),
    model: z.string().nullable().optional(),
    effort: EffortSchema.nullable().optional(),
});
export const SwitchProviderPayloadSchema = z.object({
    toProvider: ProviderSchema,
    toModel: z.string().nullable().optional(),
});
//# sourceMappingURL=limits.js.map