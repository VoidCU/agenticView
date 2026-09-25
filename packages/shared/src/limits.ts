import { z } from "zod";
import { ProviderSchema, type Provider } from "./agent.js";
import { EffortSchema } from "./models.js";
import { ErrorClassificationSchema, LimitInfoSchema, type ErrorClassification, type LimitInfo } from "./limit-info.js";
export { ErrorClassificationSchema, LimitInfoSchema, type ErrorClassification, type LimitInfo };

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
export type WindowLimit = z.infer<typeof WindowLimitSchema>;

export const ProviderModelLimitsSchema = z.object({
  provider: ProviderSchema,
  model: z.string(),
  fiveHour: WindowLimitSchema,
  weekly: WindowLimitSchema,
  updatedAt: z.string(),
});
export type ProviderModelLimits = z.infer<typeof ProviderModelLimitsSchema>;

export const ProviderLimitsEntrySchema = z.object({
  limit: LimitInfoSchema,
  models: z.record(z.string(), ProviderModelLimitsSchema),
});
export type ProviderLimitsEntry = z.infer<typeof ProviderLimitsEntrySchema>;

export const LimitsReportSchema = z.object({
  providers: z.record(ProviderSchema, ProviderLimitsEntrySchema),
  updatedAt: z.string(),
});
export type LimitsReport = z.infer<typeof LimitsReportSchema>;

export const TokenUsageBucketSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  runs: z.number().int().min(0),
});
export type TokenUsageBucket = z.infer<typeof TokenUsageBucketSchema>;

export const UsageAggregateSchema = z.object({
  session: TokenUsageBucketSchema,
  today: TokenUsageBucketSchema,
  last7Days: TokenUsageBucketSchema,
});
export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;

export const UsageReportSchema = z.object({
  agents: z.record(z.string(), UsageAggregateSchema),
  providers: z.record(ProviderSchema, UsageAggregateSchema),
  updatedAt: z.string(),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

export const SwitchAgentPayloadSchema = z.object({
  provider: ProviderSchema.nullable().optional(),
  model: z.string().nullable().optional(),
  effort: EffortSchema.nullable().optional(),
});
export type SwitchAgentPayload = z.infer<typeof SwitchAgentPayloadSchema>;

export const SwitchProviderPayloadSchema = z.object({
  toProvider: ProviderSchema,
  toModel: z.string().nullable().optional(),
});
export type SwitchProviderPayload = z.infer<typeof SwitchProviderPayloadSchema>;
