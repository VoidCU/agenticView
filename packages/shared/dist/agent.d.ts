import { z } from "zod";
export declare const ProviderSchema: z.ZodEnum<["claude", "codex", "gemini"]>;
export type Provider = z.infer<typeof ProviderSchema>;
export declare const RoleSchema: z.ZodEnum<["manager", "worker"]>;
export type Role = z.infer<typeof RoleSchema>;
export declare const ScopeSchema: z.ZodEnum<["project", "global"]>;
export type Scope = z.infer<typeof ScopeSchema>;
export declare const PermissionModeSchema: z.ZodEnum<["ask", "auto-edit", "auto"]>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export declare const ToolAllowanceSchema: z.ZodObject<{
    edit: z.ZodBoolean;
    shell: z.ZodBoolean;
    web: z.ZodBoolean;
    screenshot: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    edit: boolean;
    shell: boolean;
    web: boolean;
    screenshot: boolean;
}, {
    edit: boolean;
    shell: boolean;
    web: boolean;
    screenshot: boolean;
}>;
export type ToolAllowance = z.infer<typeof ToolAllowanceSchema>;
export declare const AgentStatsSchema: z.ZodObject<{
    xp: z.ZodNumber;
    level: z.ZodNumber;
    tasksDone: z.ZodNumber;
    tasksFailed: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    xp: number;
    level: number;
    tasksDone: number;
    tasksFailed: number;
}, {
    xp: number;
    level: number;
    tasksDone: number;
    tasksFailed: number;
}>;
export type AgentStats = z.infer<typeof AgentStatsSchema>;
export declare const AppearanceSchema: z.ZodObject<{
    color: z.ZodString;
    accent: z.ZodString;
    eyes: z.ZodEnum<["round", "visor", "dots"]>;
}, "strip", z.ZodTypeAny, {
    color: string;
    accent: string;
    eyes: "round" | "visor" | "dots";
}, {
    color: string;
    accent: string;
    eyes: "round" | "visor" | "dots";
}>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export declare const AgentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<["manager", "worker"]>;
    scope: z.ZodEnum<["project", "global"]>;
    specialty: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    provider: z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>;
    model: z.ZodNullable<z.ZodString>;
    systemPrompt: z.ZodDefault<z.ZodString>;
    tools: z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    }, {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    }>;
    permissionMode: z.ZodEnum<["ask", "auto-edit", "auto"]>;
    appearance: z.ZodObject<{
        color: z.ZodString;
        accent: z.ZodString;
        eyes: z.ZodEnum<["round", "visor", "dots"]>;
    }, "strip", z.ZodTypeAny, {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    }, {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    }>;
    stats: z.ZodObject<{
        xp: z.ZodNumber;
        level: z.ZodNumber;
        tasksDone: z.ZodNumber;
        tasksFailed: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        xp: number;
        level: number;
        tasksDone: number;
        tasksFailed: number;
    }, {
        xp: number;
        level: number;
        tasksDone: number;
        tasksFailed: number;
    }>;
    originId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    role: "manager" | "worker";
    scope: "project" | "global";
    specialty: string;
    description: string;
    provider: "claude" | "codex" | "gemini" | null;
    model: string | null;
    systemPrompt: string;
    tools: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    };
    permissionMode: "ask" | "auto-edit" | "auto";
    appearance: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    };
    stats: {
        xp: number;
        level: number;
        tasksDone: number;
        tasksFailed: number;
    };
    createdAt: string;
    updatedAt: string;
    originId?: string | undefined;
}, {
    id: string;
    name: string;
    role: "manager" | "worker";
    scope: "project" | "global";
    specialty: string;
    provider: "claude" | "codex" | "gemini" | null;
    model: string | null;
    tools: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    };
    permissionMode: "ask" | "auto-edit" | "auto";
    appearance: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    };
    stats: {
        xp: number;
        level: number;
        tasksDone: number;
        tasksFailed: number;
    };
    createdAt: string;
    updatedAt: string;
    description?: string | undefined;
    systemPrompt?: string | undefined;
    originId?: string | undefined;
}>;
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
