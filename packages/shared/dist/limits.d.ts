import { z } from "zod";
import { ErrorClassificationSchema, LimitInfoSchema, type ErrorClassification, type LimitInfo } from "./limit-info.js";
export { ErrorClassificationSchema, LimitInfoSchema, type ErrorClassification, type LimitInfo };
export declare const WindowLimitSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"not reported">;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"reported">;
    percentLeft: z.ZodNumber;
    usedPercent: z.ZodNumber;
    resetAt: z.ZodOptional<z.ZodString>;
    windowMinutes: z.ZodOptional<z.ZodNumber>;
    warning: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>], "status">;
export type WindowLimit = z.infer<typeof WindowLimitSchema>;
/** Body for POST /api/claude-limits (posted by the agenticview skill running in Claude Code). */
export declare const ClaudeLimitsBodySchema: z.ZodObject<{
    session_id: z.ZodString;
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        display_name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>;
    cwd: z.ZodOptional<z.ZodString>;
    rate_limits: z.ZodOptional<z.ZodObject<{
        five_hour: z.ZodOptional<z.ZodObject<{
            used_percentage: z.ZodNumber;
            resets_at: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        seven_day: z.ZodOptional<z.ZodObject<{
            used_percentage: z.ZodNumber;
            resets_at: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ClaudeLimitsBody = z.infer<typeof ClaudeLimitsBodySchema>;
export declare const ProviderModelLimitsSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>;
    model: z.ZodString;
    fiveHour: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"not reported">;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"reported">;
        percentLeft: z.ZodNumber;
        usedPercent: z.ZodNumber;
        resetAt: z.ZodOptional<z.ZodString>;
        windowMinutes: z.ZodOptional<z.ZodNumber>;
        warning: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>], "status">;
    weekly: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"not reported">;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"reported">;
        percentLeft: z.ZodNumber;
        usedPercent: z.ZodNumber;
        resetAt: z.ZodOptional<z.ZodString>;
        windowMinutes: z.ZodOptional<z.ZodNumber>;
        warning: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>], "status">;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type ProviderModelLimits = z.infer<typeof ProviderModelLimitsSchema>;
export declare const ProviderLimitsEntrySchema: z.ZodObject<{
    limit: z.ZodObject<{
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
    models: z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodEnum<{
            claude: "claude";
            "claude-session": "claude-session";
            codex: "codex";
            antigravity: "antigravity";
            gemini: "gemini";
        }>;
        model: z.ZodString;
        fiveHour: z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"not reported">;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"reported">;
            percentLeft: z.ZodNumber;
            usedPercent: z.ZodNumber;
            resetAt: z.ZodOptional<z.ZodString>;
            windowMinutes: z.ZodOptional<z.ZodNumber>;
            warning: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>], "status">;
        weekly: z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"not reported">;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"reported">;
            percentLeft: z.ZodNumber;
            usedPercent: z.ZodNumber;
            resetAt: z.ZodOptional<z.ZodString>;
            windowMinutes: z.ZodOptional<z.ZodNumber>;
            warning: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>], "status">;
        updatedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProviderLimitsEntry = z.infer<typeof ProviderLimitsEntrySchema>;
export declare const LimitsReportSchema: z.ZodObject<{
    providers: z.ZodRecord<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>, z.ZodObject<{
        limit: z.ZodObject<{
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
        models: z.ZodRecord<z.ZodString, z.ZodObject<{
            provider: z.ZodEnum<{
                claude: "claude";
                "claude-session": "claude-session";
                codex: "codex";
                antigravity: "antigravity";
                gemini: "gemini";
            }>;
            model: z.ZodString;
            fiveHour: z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"not reported">;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"reported">;
                percentLeft: z.ZodNumber;
                usedPercent: z.ZodNumber;
                resetAt: z.ZodOptional<z.ZodString>;
                windowMinutes: z.ZodOptional<z.ZodNumber>;
                warning: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>], "status">;
            weekly: z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"not reported">;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"reported">;
                percentLeft: z.ZodNumber;
                usedPercent: z.ZodNumber;
                resetAt: z.ZodOptional<z.ZodString>;
                windowMinutes: z.ZodOptional<z.ZodNumber>;
                warning: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>], "status">;
            updatedAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type LimitsReport = z.infer<typeof LimitsReportSchema>;
export declare const TokenUsageBucketSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
    runs: z.ZodNumber;
}, z.core.$strip>;
export type TokenUsageBucket = z.infer<typeof TokenUsageBucketSchema>;
export declare const UsageAggregateSchema: z.ZodObject<{
    session: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        runs: z.ZodNumber;
    }, z.core.$strip>;
    today: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        runs: z.ZodNumber;
    }, z.core.$strip>;
    last7Days: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        runs: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;
export declare const UsageReportSchema: z.ZodObject<{
    agents: z.ZodRecord<z.ZodString, z.ZodObject<{
        session: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
        today: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
        last7Days: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    providers: z.ZodRecord<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>, z.ZodObject<{
        session: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
        today: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
        last7Days: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            runs: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type UsageReport = z.infer<typeof UsageReportSchema>;
export declare const SwitchAgentPayloadSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    effort: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
        ultra: "ultra";
    }>>>;
}, z.core.$strip>;
export type SwitchAgentPayload = z.infer<typeof SwitchAgentPayloadSchema>;
export declare const SwitchProviderPayloadSchema: z.ZodObject<{
    toProvider: z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>;
    toModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type SwitchProviderPayload = z.infer<typeof SwitchProviderPayloadSchema>;
