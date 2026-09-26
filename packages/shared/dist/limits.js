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
        /** True when usedPercent >= 80 (approaching the limit). */
        warning: z.boolean().optional(),
    }),
]);
/** One rate-limit window posted by a Claude Code session worker. */
const ClaudeRateLimitWindowSchema = z.object({
    used_percentage: z.number().min(0).max(100),
    resets_at: z.number().optional(),
});
/** Body for POST /api/claude-limits (posted by the agenticview skill running in Claude Code). */
export const ClaudeLimitsBodySchema = z.object({
    session_id: z.string().min(1).max(64),
    model: z.union([
        z.string(),
        z.object({ id: z.string().optional(), display_name: z.string().optional() }),
    ]).optional(),
    cwd: z.string().max(1000).optional(),
    rate_limits: z.object({
        five_hour: ClaudeRateLimitWindowSchema.optional(),
        seven_day: ClaudeRateLimitWindowSchema.optional(),
    }).optional(),
});
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