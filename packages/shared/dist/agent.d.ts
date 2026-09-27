import { z } from "zod";
export declare const BUILTIN_PROVIDERS: readonly ["claude", "claude-session", "codex", "copilot", "antigravity", "gemini"];
export declare const BuiltinProviderSchema: z.ZodEnum<{
    claude: "claude";
    codex: "codex";
    gemini: "gemini";
    "claude-session": "claude-session";
    copilot: "copilot";
    antigravity: "antigravity";
}>;
export type BuiltinProvider = z.infer<typeof BuiltinProviderSchema>;
/** Prefix of a user-configured provider id ("custom:<slug>"); the slug is the entry's id in config.providers.custom. */
export declare const CUSTOM_PROVIDER_PREFIX = "custom:";
export type CustomProviderRef = `custom:${string}`;
export declare const CUSTOM_SLUG_RE: RegExp;
export declare const CustomProviderRefSchema: z.ZodType<CustomProviderRef>;
/** A built-in provider, or a user-configured OpenAI-/Anthropic-compatible endpoint ("custom:<slug>"). */
export declare const ProviderSchema: z.ZodUnion<readonly [z.ZodEnum<{
    claude: "claude";
    codex: "codex";
    gemini: "gemini";
    "claude-session": "claude-session";
    copilot: "copilot";
    antigravity: "antigravity";
}>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
export type Provider = BuiltinProvider | CustomProviderRef;
export declare function isCustomProvider(p: string | null | undefined): p is CustomProviderRef;
export declare function isBuiltinProvider(p: string | null | undefined): p is BuiltinProvider;
export declare const RoleSchema: z.ZodEnum<{
    manager: "manager";
    worker: "worker";
}>;
export type Role = z.infer<typeof RoleSchema>;
export declare const ScopeSchema: z.ZodEnum<{
    project: "project";
    global: "global";
}>;
export type Scope = z.infer<typeof ScopeSchema>;
export declare const PermissionModeSchema: z.ZodEnum<{
    auto: "auto";
    ask: "ask";
    "auto-edit": "auto-edit";
}>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export declare const ToolAllowanceSchema: z.ZodObject<{
    edit: z.ZodBoolean;
    shell: z.ZodBoolean;
    web: z.ZodBoolean;
    screenshot: z.ZodBoolean;
}, z.core.$strip>;
export type ToolAllowance = z.infer<typeof ToolAllowanceSchema>;
export declare const AgentStatsSchema: z.ZodObject<{
    xp: z.ZodNumber;
    level: z.ZodNumber;
    tasksDone: z.ZodNumber;
    tasksFailed: z.ZodNumber;
}, z.core.$strip>;
export type AgentStats = z.infer<typeof AgentStatsSchema>;
export declare const AppearanceSchema: z.ZodObject<{
    color: z.ZodString;
    accent: z.ZodString;
    eyes: z.ZodEnum<{
        round: "round";
        visor: "visor";
        dots: "dots";
    }>;
}, z.core.$strip>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export declare const PlacementSchema: z.ZodObject<{
    space: z.ZodString;
    seat: z.ZodNumber;
}, z.core.$strip>;
export type Placement = z.infer<typeof PlacementSchema>;
/**
 * Revive state machine after a provider failure. For a quota / rate limit (`cause` "limit") the office
 * shows it as a walk: fainted = the agent walks to the Manager's desk and reports the limit; reviving =
 * it stands there while the switch is decided; done = it says "Switching to <switchTo>!" and walks
 * back to its seat while the retried task runs. A crash (`cause` "crash") faints in the lounge instead.
 */
export declare const AgentReviveSchema: z.ZodObject<{
    phase: z.ZodEnum<{
        fainted: "fainted";
        reviving: "reviving";
        done: "done";
    }>;
    cause: z.ZodOptional<z.ZodEnum<{
        crash: "crash";
        limit: "limit";
    }>>;
    failedProvider: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
    managerId: z.ZodOptional<z.ZodString>;
    suggested: z.ZodOptional<z.ZodObject<{
        provider: z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
        model: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    switchTo: z.ZodOptional<z.ZodObject<{
        provider: z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    failedTaskId: z.ZodOptional<z.ZodString>;
    resetAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentRevive = z.infer<typeof AgentReviveSchema>;
export declare const AgentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        manager: "manager";
        worker: "worker";
    }>;
    scope: z.ZodEnum<{
        project: "project";
        global: "global";
    }>;
    specialty: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    provider: z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
    model: z.ZodNullable<z.ZodString>;
    effort: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
        ultra: "ultra";
    }>>>;
    systemPrompt: z.ZodDefault<z.ZodString>;
    tools: z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, z.core.$strip>;
    permissionMode: z.ZodEnum<{
        auto: "auto";
        ask: "ask";
        "auto-edit": "auto-edit";
    }>;
    appearance: z.ZodObject<{
        color: z.ZodString;
        accent: z.ZodString;
        eyes: z.ZodEnum<{
            round: "round";
            visor: "visor";
            dots: "dots";
        }>;
    }, z.core.$strip>;
    stats: z.ZodObject<{
        xp: z.ZodNumber;
        level: z.ZodNumber;
        tasksDone: z.ZodNumber;
        tasksFailed: z.ZodNumber;
    }, z.core.$strip>;
    originId: z.ZodOptional<z.ZodString>;
    placement: z.ZodOptional<z.ZodObject<{
        space: z.ZodString;
        seat: z.ZodNumber;
    }, z.core.$strip>>;
    workSeat: z.ZodOptional<z.ZodObject<{
        space: z.ZodString;
        seat: z.ZodNumber;
    }, z.core.$strip>>;
    session: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    limit: z.ZodOptional<z.ZodObject<{
        limited: z.ZodBoolean;
        errorType: z.ZodOptional<z.ZodEnum<{
            quota: "quota";
            "rate-limit": "rate-limit";
            auth: "auth";
            crash: "crash";
        }>>;
        reason: z.ZodOptional<z.ZodString>;
        resetAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    revive: z.ZodOptional<z.ZodObject<{
        phase: z.ZodEnum<{
            fainted: "fainted";
            reviving: "reviving";
            done: "done";
        }>;
        cause: z.ZodOptional<z.ZodEnum<{
            crash: "crash";
            limit: "limit";
        }>>;
        failedProvider: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
        managerId: z.ZodOptional<z.ZodString>;
        suggested: z.ZodOptional<z.ZodObject<{
            provider: z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                gemini: "gemini";
                "claude-session": "claude-session";
                copilot: "copilot";
                antigravity: "antigravity";
            }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        switchTo: z.ZodOptional<z.ZodObject<{
            provider: z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                gemini: "gemini";
                "claude-session": "claude-session";
                copilot: "copilot";
                antigravity: "antigravity";
            }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
            model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        failedTaskId: z.ZodOptional<z.ZodString>;
        resetAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    lounging: z.ZodOptional<z.ZodBoolean>;
    visiting: z.ZodOptional<z.ZodObject<{
        targetAgentId: z.ZodOptional<z.ZodString>;
        spaceId: z.ZodOptional<z.ZodString>;
        until: z.ZodString;
    }, z.core.$strip>>;
    sessionModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type Agent = z.infer<typeof AgentSchema>;
export declare const PALETTE: readonly ["#5b8cff", "#ff7a59", "#3ddc97", "#ffc857", "#b084f5", "#ff5fa2", "#4fd1ff"];
export declare const MANAGER_TOOLS: ToolAllowance;
export declare const WORKER_TOOLS: ToolAllowance;
export type AgentInit = {
    name: string;
    role: Role;
    scope: Scope;
    specialty: string;
} & Partial<Omit<Agent, "name" | "role" | "scope" | "specialty">>;
export declare function defaultAgent(init: AgentInit): Agent;
/** Automatic provider resolution order: the first provider whose check() is ok wins. */
export declare const PROVIDER_ORDER: readonly BuiltinProvider[];
export declare const PROVIDER_LABELS: Record<BuiltinProvider, string>;
