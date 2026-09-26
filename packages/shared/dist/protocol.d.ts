import { z } from "zod";
import { type Agent, type Provider } from "./agent.js";
import { type Task } from "./task.js";
import { type ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
import { type WorkerSessionInfo } from "./session.js";
import { type Match, type GamesData, type GameRoundResult } from "./games.js";
export type { Match, GamesData, GameRoundResult };
export declare const ProviderStatusSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>;
    ok: z.ZodBoolean;
    version: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
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
    systemPrompt: z.ZodOptional<z.ZodString>;
    tools: z.ZodOptional<z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, z.core.$strip>>;
    permissionMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        ask: "ask";
        "auto-edit": "auto-edit";
    }>>;
    scope: z.ZodOptional<z.ZodEnum<{
        project: "project";
        global: "global";
    }>>;
    session: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
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
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>>;
    session: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    effort: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
        ultra: "ultra";
    }>>>>;
    name: z.ZodOptional<z.ZodString>;
    tools: z.ZodOptional<z.ZodObject<{
        edit: z.ZodBoolean;
        shell: z.ZodBoolean;
        web: z.ZodBoolean;
        screenshot: z.ZodBoolean;
    }, z.core.$strip>>;
    permissionMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        ask: "ask";
        "auto-edit": "auto-edit";
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
    specialty: z.ZodOptional<z.ZodString>;
    placement: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        space: z.ZodString;
        seat: z.ZodNumber;
    }, z.core.$strip>>>;
    revive: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        phase: z.ZodEnum<{
            fainted: "fainted";
            reviving: "reviving";
            done: "done";
        }>;
        managerId: z.ZodOptional<z.ZodString>;
        suggested: z.ZodOptional<z.ZodObject<{
            provider: z.ZodEnum<{
                claude: "claude";
                "claude-session": "claude-session";
                codex: "codex";
                antigravity: "antigravity";
                gemini: "gemini";
            }>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        failedTaskId: z.ZodOptional<z.ZodString>;
        resetAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    lounging: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    description: z.ZodOptional<z.ZodString>;
    systemPrompt: z.ZodOptional<z.ZodString>;
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
        systemPrompt: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodObject<{
            edit: z.ZodBoolean;
            shell: z.ZodBoolean;
            web: z.ZodBoolean;
            screenshot: z.ZodBoolean;
        }, z.core.$strip>>;
        permissionMode: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            ask: "ask";
            "auto-edit": "auto-edit";
        }>>;
        scope: z.ZodOptional<z.ZodEnum<{
            project: "project";
            global: "global";
        }>>;
        session: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
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
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        provider: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            claude: "claude";
            "claude-session": "claude-session";
            codex: "codex";
            antigravity: "antigravity";
            gemini: "gemini";
        }>>>;
        session: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>>;
        effort: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            minimal: "minimal";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
            ultra: "ultra";
        }>>>>;
        name: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodObject<{
            edit: z.ZodBoolean;
            shell: z.ZodBoolean;
            web: z.ZodBoolean;
            screenshot: z.ZodBoolean;
        }, z.core.$strip>>;
        permissionMode: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            ask: "ask";
            "auto-edit": "auto-edit";
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
        specialty: z.ZodOptional<z.ZodString>;
        placement: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            space: z.ZodString;
            seat: z.ZodNumber;
        }, z.core.$strip>>>;
        revive: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            phase: z.ZodEnum<{
                fainted: "fainted";
                reviving: "reviving";
                done: "done";
            }>;
            managerId: z.ZodOptional<z.ZodString>;
            suggested: z.ZodOptional<z.ZodObject<{
                provider: z.ZodEnum<{
                    claude: "claude";
                    "claude-session": "claude-session";
                    codex: "codex";
                    antigravity: "antigravity";
                    gemini: "gemini";
                }>;
                model: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            failedTaskId: z.ZodOptional<z.ZodString>;
            resetAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        lounging: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        description: z.ZodOptional<z.ZodString>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.switch">;
    id: z.ZodString;
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
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider.switchAll">;
    fromProvider: z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>;
    toProvider: z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>;
    toModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
    type: z.ZodLiteral<"task.retry">;
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
            "claude-session": "claude-session";
            codex: "codex";
            antigravity: "antigravity";
            gemini: "gemini";
        }>>>>;
        defaultModel: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodString>>>;
        maxConcurrentRuns: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        limitPolicy: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            auto: "auto";
            ask: "ask";
        }>>>;
        loungeBreaks: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        preferCheapModels: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        idleLoungeMinutes: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"project.open">;
    path: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"session.rename">;
    id: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"session.forget">;
    id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"session.capacity">;
    id: z.ZodString;
    capacity: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"limit.respond">;
    id: z.ZodString;
    answer: z.ZodEnum<{
        accept: "accept";
        choose: "choose";
        dismiss: "dismiss";
    }>;
    provider: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"game.play">;
    opponentId: z.ZodString;
    matchId: z.ZodOptional<z.ZodString>;
    move: z.ZodEnum<{
        rock: "rock";
        paper: "paper";
        scissors: "scissors";
    }>;
}, z.core.$strip>], "type">;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export interface PendingLimitInfo {
    id: string;
    agentId: string;
    taskId: string;
    suggested?: {
        provider: Provider;
        model?: string;
    };
    resetAt?: string;
    reason?: string;
}
export interface BrainstormParticipant {
    agentId: string;
    name: string;
    answer?: string;
    done: boolean;
}
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
export declare const SpaceNamesSchema: z.ZodRecord<z.ZodString, z.ZodString>;
export interface Snapshot {
    spaceNames?: Record<string, string>;
    world: WorldInfo;
    agents: Agent[];
    /** Tasks on the wire carry an empty `log`; the persisted task keeps the full log. */
    tasks: Task[];
    providers: ProviderStatus[];
    /** What "Automatic" resolves to right now (first available provider), or null when none is. */
    autoProvider?: Provider | null;
    settings: ProjectSettings;
    permissions: PendingPermissionInfo[];
    questions: PendingQuestionInfo[];
    limits?: PendingLimitInfo[];
    /** Claude Code sessions known to this office (claude-session workers). */
    sessions?: WorkerSessionInfo[];
    /**
     * Highest ring index currently in the office layout (0 = only the Manager's Office,
     * 1 = ring-1 rooms present, up to MAX_RINGS = 3).  Used by the camera to auto-fit the scene.
     */
    ringCount?: number;
    /** Rock-paper-scissors games: leaderboard and recent matches. */
    games?: GamesData;
}
export type MirrorEvent = {
    kind: string;
    text: string;
    ts: string;
};
export type ServerMessage = ({
    type: "snapshot";
} & Snapshot) | {
    type: "spaceNames.updated";
    spaceNames: Record<string, string>;
} | {
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
} | {
    type: "providers.updated";
    providers: ProviderStatus[];
    autoProvider: Provider | null;
} | {
    type: "sessions.updated";
    sessions: WorkerSessionInfo[];
} | {
    type: "limit.request";
    id: string;
    agentId: string;
    taskId: string;
    suggested?: {
        provider: Provider;
        model?: string;
    };
    resetAt?: string;
    reason?: string;
} | {
    type: "limit.resolved";
    id: string;
} | {
    type: "brainstorm.updated";
    managerId: string;
    requestTaskId: string;
    topic: string;
    participants: BrainstormParticipant[];
    skipped: {
        agentId: string;
        name: string;
        reason: string;
    }[];
    complete: boolean;
    error?: string;
} | {
    type: "game.round";
    matchId: string;
    round: number;
    userMove: Match["moves"][0];
    agentMove: Match["moves"][1];
    winner: "you" | "agent" | null;
    score: {
        you: number;
        agent: number;
    };
    done: boolean;
} | {
    type: "game.result";
    match: Match;
};
