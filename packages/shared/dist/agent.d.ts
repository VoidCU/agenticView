import { z } from "zod";
export declare const ProviderSchema: z.ZodEnum<{
    claude: "claude";
    "claude-session": "claude-session";
    codex: "codex";
    gemini: "gemini";
}>;
export type Provider = z.infer<typeof ProviderSchema>;
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
    ask: "ask";
    "auto-edit": "auto-edit";
    auto: "auto";
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
    provider: z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        gemini: "gemini";
    }>>;
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
        ask: "ask";
        "auto-edit": "auto-edit";
        auto: "auto";
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
    session: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
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
export declare const PROVIDER_ORDER: readonly Provider[];
export declare const PROVIDER_LABELS: Record<Provider, string>;
