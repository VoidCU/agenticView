import { z } from "zod";
import { type Agent } from "./agent.js";
import { type Task } from "./task.js";
import { type ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
export declare const ProviderStatusSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
    }>;
    ok: z.ZodBoolean;
    version: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export declare const WorldInfoSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        project: "project";
        hub: "hub";
    }>;
    name: z.ZodString;
    projectPath: z.ZodNullable<z.ZodString>;
    knownProjects: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        name: z.ZodString;
        lastOpened: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type WorldInfo = z.infer<typeof WorldInfoSchema>;
export declare const CreateAgentPayloadSchema: z.ZodObject<{
    name: z.ZodString;
    specialty: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
    }>>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    tools: z.ZodOptional<z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, z.core.$strip>>;
    permissionMode: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        "auto-edit": "auto-edit";
        auto: "auto";
    }>>;
    scope: z.ZodOptional<z.ZodEnum<{
        project: "project";
        global: "global";
    }>>;
    appearance: z.ZodOptional<z.ZodObject<{
        color: z.ZodString;
        accent: z.ZodString;
        eyes: z.ZodEnum<{
            round: "round";
            visor: "visor";
            dots: "dots";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CreateAgentPayload = z.infer<typeof CreateAgentPayloadSchema>;
export declare const AgentPatchSchema: z.ZodObject<{
    tools: z.ZodOptional<z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, z.core.$strip>>;
    permissionMode: z.ZodOptional<z.ZodEnum<{
        ask: "ask";
        "auto-edit": "auto-edit";
        auto: "auto";
    }>>;
    appearance: z.ZodOptional<z.ZodObject<{
        color: z.ZodString;
        accent: z.ZodString;
        eyes: z.ZodEnum<{
            round: "round";
            visor: "visor";
            dots: "dots";
        }>;
    }, z.core.$strip>>;
    name: z.ZodOptional<z.ZodString>;
    specialty: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
    }>>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    systemPrompt: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, z.core.$strip>;
export type AgentPatch = z.infer<typeof AgentPatchSchema>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"snapshot.request">;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"chat.send">;
    agentId: z.ZodString;
    text: z.ZodString;
    images: z.ZodDefault<z.ZodArray<z.ZodString>>;
    projectPath: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.create">;
    agent: z.ZodObject<{
        name: z.ZodString;
        specialty: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
        }>>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodObject<{
            edit: z.ZodBoolean;
            shell: z.ZodBoolean;
            web: z.ZodBoolean;
            screenshot: z.ZodBoolean;
        }, z.core.$strip>>;
        permissionMode: z.ZodOptional<z.ZodEnum<{
            ask: "ask";
            "auto-edit": "auto-edit";
            auto: "auto";
        }>>;
        scope: z.ZodOptional<z.ZodEnum<{
            project: "project";
            global: "global";
        }>>;
        appearance: z.ZodOptional<z.ZodObject<{
            color: z.ZodString;
            accent: z.ZodString;
            eyes: z.ZodEnum<{
                round: "round";
                visor: "visor";
                dots: "dots";
            }>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.update">;
    id: z.ZodString;
    patch: z.ZodObject<{
        tools: z.ZodOptional<z.ZodObject<{
            edit: z.ZodBoolean;
            shell: z.ZodBoolean;
            web: z.ZodBoolean;
            screenshot: z.ZodBoolean;
        }, z.core.$strip>>;
        permissionMode: z.ZodOptional<z.ZodEnum<{
            ask: "ask";
            "auto-edit": "auto-edit";
            auto: "auto";
        }>>;
        appearance: z.ZodOptional<z.ZodObject<{
            color: z.ZodString;
            accent: z.ZodString;
            eyes: z.ZodEnum<{
                round: "round";
                visor: "visor";
                dots: "dots";
            }>;
        }, z.core.$strip>>;
        name: z.ZodOptional<z.ZodString>;
        specialty: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
        }>>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        systemPrompt: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.copyToProject">;
    id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.delete">;
    id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"task.cancel">;
    id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"permission.respond">;
    id: z.ZodString;
    allow: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"question.respond">;
    id: z.ZodString;
    answer: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"settings.update">;
    settings: z.ZodObject<{
        defaultProvider: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
        }>>>>;
        defaultModel: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodString>>>;
        maxConcurrentRuns: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"project.open">;
    path: z.ZodString;
}, z.core.$strip>], "type">;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export interface PendingPermissionInfo {
    id: string;
    agentId: string;
    taskId: string;
    tool: string;
    input: unknown;
}
export interface PendingQuestionInfo {
    id: string;
    agentId: string;
    taskId: string;
    question: string;
}
export interface Snapshot {
    world: WorldInfo;
    agents: Agent[];
    /** Tasks on the wire carry an empty `log`; the persisted task keeps the full log. */
    tasks: Task[];
    providers: ProviderStatus[];
    settings: ProjectSettings;
    permissions: PendingPermissionInfo[];
    questions: PendingQuestionInfo[];
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
