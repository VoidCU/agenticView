import { z } from "zod";
import { type Agent } from "./agent.js";
import { type Task } from "./task.js";
import { type ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
export declare const ProviderStatusSchema: z.ZodObject<{
    provider: z.ZodEnum<["claude", "codex", "gemini"]>;
    ok: z.ZodBoolean;
    version: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    provider: "claude" | "codex" | "gemini";
    ok: boolean;
    version?: string | undefined;
    reason?: string | undefined;
}, {
    provider: "claude" | "codex" | "gemini";
    ok: boolean;
    version?: string | undefined;
    reason?: string | undefined;
}>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export declare const WorldInfoSchema: z.ZodObject<{
    kind: z.ZodEnum<["project", "hub"]>;
    name: z.ZodString;
    projectPath: z.ZodNullable<z.ZodString>;
    knownProjects: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        name: z.ZodString;
        lastOpened: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        name: string;
        lastOpened: string;
    }, {
        path: string;
        name: string;
        lastOpened: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    kind: "project" | "hub";
    projectPath: string | null;
    knownProjects: {
        path: string;
        name: string;
        lastOpened: string;
    }[];
}, {
    name: string;
    kind: "project" | "hub";
    projectPath: string | null;
    knownProjects: {
        path: string;
        name: string;
        lastOpened: string;
    }[];
}>;
export type WorldInfo = z.infer<typeof WorldInfoSchema>;
export declare const CreateAgentPayloadSchema: z.ZodObject<{
    name: z.ZodString;
    specialty: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    tools: z.ZodOptional<z.ZodObject<{
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
    }>>;
    permissionMode: z.ZodOptional<z.ZodEnum<["ask", "auto-edit", "auto"]>>;
    scope: z.ZodOptional<z.ZodEnum<["project", "global"]>>;
    appearance: z.ZodOptional<z.ZodObject<{
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
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    specialty: string;
    scope?: "project" | "global" | undefined;
    description?: string | undefined;
    provider?: "claude" | "codex" | "gemini" | null | undefined;
    model?: string | null | undefined;
    systemPrompt?: string | undefined;
    tools?: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    } | undefined;
    permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
    appearance?: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    } | undefined;
}, {
    name: string;
    specialty: string;
    scope?: "project" | "global" | undefined;
    description?: string | undefined;
    provider?: "claude" | "codex" | "gemini" | null | undefined;
    model?: string | null | undefined;
    systemPrompt?: string | undefined;
    tools?: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    } | undefined;
    permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
    appearance?: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    } | undefined;
}>;
export type CreateAgentPayload = z.infer<typeof CreateAgentPayloadSchema>;
export declare const AgentPatchSchema: z.ZodObject<Omit<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<["manager", "worker"]>>;
    scope: z.ZodOptional<z.ZodEnum<["project", "global"]>>;
    specialty: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    systemPrompt: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    tools: z.ZodOptional<z.ZodObject<{
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
    }>>;
    permissionMode: z.ZodOptional<z.ZodEnum<["ask", "auto-edit", "auto"]>>;
    appearance: z.ZodOptional<z.ZodObject<{
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
    }>>;
    stats: z.ZodOptional<z.ZodObject<{
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
    }>>;
    originId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "id" | "role" | "scope" | "stats" | "originId" | "createdAt" | "updatedAt">, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    specialty?: string | undefined;
    description?: string | undefined;
    provider?: "claude" | "codex" | "gemini" | null | undefined;
    model?: string | null | undefined;
    systemPrompt?: string | undefined;
    tools?: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    } | undefined;
    permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
    appearance?: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    } | undefined;
}, {
    name?: string | undefined;
    specialty?: string | undefined;
    description?: string | undefined;
    provider?: "claude" | "codex" | "gemini" | null | undefined;
    model?: string | null | undefined;
    systemPrompt?: string | undefined;
    tools?: {
        edit: boolean;
        shell: boolean;
        web: boolean;
        screenshot: boolean;
    } | undefined;
    permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
    appearance?: {
        color: string;
        accent: string;
        eyes: "round" | "visor" | "dots";
    } | undefined;
}>;
export type AgentPatch = z.infer<typeof AgentPatchSchema>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"snapshot.request">;
}, "strip", z.ZodTypeAny, {
    type: "snapshot.request";
}, {
    type: "snapshot.request";
}>, z.ZodObject<{
    type: z.ZodLiteral<"chat.send">;
    agentId: z.ZodString;
    text: z.ZodString;
    images: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    projectPath: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "chat.send";
    text: string;
    images: string[];
    agentId: string;
    projectPath?: string | undefined;
}, {
    type: "chat.send";
    text: string;
    agentId: string;
    projectPath?: string | undefined;
    images?: string[] | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"agent.create">;
    agent: z.ZodObject<{
        name: z.ZodString;
        specialty: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodObject<{
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
        }>>;
        permissionMode: z.ZodOptional<z.ZodEnum<["ask", "auto-edit", "auto"]>>;
        scope: z.ZodOptional<z.ZodEnum<["project", "global"]>>;
        appearance: z.ZodOptional<z.ZodObject<{
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
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        specialty: string;
        scope?: "project" | "global" | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    }, {
        name: string;
        specialty: string;
        scope?: "project" | "global" | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "agent.create";
    agent: {
        name: string;
        specialty: string;
        scope?: "project" | "global" | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    };
}, {
    type: "agent.create";
    agent: {
        name: string;
        specialty: string;
        scope?: "project" | "global" | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"agent.update">;
    id: z.ZodString;
    patch: z.ZodObject<Omit<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodEnum<["manager", "worker"]>>;
        scope: z.ZodOptional<z.ZodEnum<["project", "global"]>>;
        specialty: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        systemPrompt: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        tools: z.ZodOptional<z.ZodObject<{
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
        }>>;
        permissionMode: z.ZodOptional<z.ZodEnum<["ask", "auto-edit", "auto"]>>;
        appearance: z.ZodOptional<z.ZodObject<{
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
        }>>;
        stats: z.ZodOptional<z.ZodObject<{
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
        }>>;
        originId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
    }, "id" | "role" | "scope" | "stats" | "originId" | "createdAt" | "updatedAt">, "strip", z.ZodTypeAny, {
        name?: string | undefined;
        specialty?: string | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    }, {
        name?: string | undefined;
        specialty?: string | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "agent.update";
    id: string;
    patch: {
        name?: string | undefined;
        specialty?: string | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    };
}, {
    type: "agent.update";
    id: string;
    patch: {
        name?: string | undefined;
        specialty?: string | undefined;
        description?: string | undefined;
        provider?: "claude" | "codex" | "gemini" | null | undefined;
        model?: string | null | undefined;
        systemPrompt?: string | undefined;
        tools?: {
            edit: boolean;
            shell: boolean;
            web: boolean;
            screenshot: boolean;
        } | undefined;
        permissionMode?: "ask" | "auto-edit" | "auto" | undefined;
        appearance?: {
            color: string;
            accent: string;
            eyes: "round" | "visor" | "dots";
        } | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"agent.copyToProject">;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "agent.copyToProject";
    id: string;
}, {
    type: "agent.copyToProject";
    id: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"agent.delete">;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "agent.delete";
    id: string;
}, {
    type: "agent.delete";
    id: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"task.cancel">;
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "task.cancel";
    id: string;
}, {
    type: "task.cancel";
    id: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"permission.respond">;
    id: z.ZodString;
    allow: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    type: "permission.respond";
    id: string;
    allow: boolean;
}, {
    type: "permission.respond";
    id: string;
    allow: boolean;
}>, z.ZodObject<{
    type: z.ZodLiteral<"question.respond">;
    id: z.ZodString;
    answer: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "question.respond";
    id: string;
    answer: string;
}, {
    type: "question.respond";
    id: string;
    answer: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"settings.update">;
    settings: z.ZodObject<{
        defaultProvider: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>>;
        defaultModel: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodString>>>;
        maxConcurrentRuns: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        defaultProvider?: "claude" | "codex" | "gemini" | null | undefined;
        defaultModel?: string | null | undefined;
        maxConcurrentRuns?: number | undefined;
    }, {
        defaultProvider?: "claude" | "codex" | "gemini" | null | undefined;
        defaultModel?: string | null | undefined;
        maxConcurrentRuns?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "settings.update";
    settings: {
        defaultProvider?: "claude" | "codex" | "gemini" | null | undefined;
        defaultModel?: string | null | undefined;
        maxConcurrentRuns?: number | undefined;
    };
}, {
    type: "settings.update";
    settings: {
        defaultProvider?: "claude" | "codex" | "gemini" | null | undefined;
        defaultModel?: string | null | undefined;
        maxConcurrentRuns?: number | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"project.open">;
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "project.open";
}, {
    path: string;
    type: "project.open";
}>]>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export interface Snapshot {
    world: WorldInfo;
    agents: Agent[];
    tasks: Task[];
    providers: ProviderStatus[];
    settings: ProjectSettings;
}
export type MirrorEvent = {
    kind: string;
    text: string;
    ts: string;
};
export type ServerMessage = ({
    type: "snapshot";
} & Snapshot) | {
    type: "agent.updated";
    agent: Agent;
} | {
    type: "agent.removed";
    id: string;
} | {
    type: "task.updated";
    task: Task;
} | {
    type: "run.event";
    taskId: string;
    agentId: string;
    event: RunEvent;
} | {
    type: "permission.request";
    id: string;
    agentId: string;
    taskId: string;
    tool: string;
    input: unknown;
} | {
    type: "permission.resolved";
    id: string;
} | {
    type: "question.request";
    id: string;
    agentId: string;
    taskId: string;
    question: string;
} | {
    type: "question.resolved";
    id: string;
} | {
    type: "mirror.event";
    event: MirrorEvent;
} | {
    type: "error";
    message: string;
    ref?: string;
} | {
    type: "opened";
    url: string;
};
