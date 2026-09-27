import { z } from "zod";
import { type Agent, type Provider } from "./agent.js";
import { type Task } from "./task.js";
import { type ProjectSettings } from "./settings.js";
import type { RunEvent } from "./runtime.js";
import { type WorkerSessionInfo } from "./session.js";
import { type Match, type GamesData, type GameRoundResult } from "./games.js";
import { type CustomProviderInfo, type KeyedProvider } from "./providers.js";
import { type OfficeLayout } from "./office.js";
export type { Match, GamesData, GameRoundResult };
export declare const ProviderStatusSchema: z.ZodObject<{
    provider: z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
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
    layout: z.ZodOptional<z.ZodObject<{
        version: z.ZodLiteral<1>;
        rooms: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                meeting: "meeting";
                office: "office";
                pod: "pod";
                lounge: "lounge";
                myoffice: "myoffice";
                production: "production";
                research: "research";
            }>;
            name: z.ZodOptional<z.ZodString>;
            q: z.ZodNumber;
            r: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type WorldInfo = z.infer<typeof WorldInfoSchema>;
export declare const CreateAgentPayloadSchema: z.ZodObject<{
    name: z.ZodString;
    specialty: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>;
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
    provider: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>;
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
    }, z.core.$strip>>>;
    lounging: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    visiting: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        targetAgentId: z.ZodOptional<z.ZodString>;
        spaceId: z.ZodOptional<z.ZodString>;
        until: z.ZodString;
    }, z.core.$strip>>>;
    sessionModel: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
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
        provider: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>;
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
        provider: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>;
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
        }, z.core.$strip>>>;
        lounging: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        visiting: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            targetAgentId: z.ZodOptional<z.ZodString>;
            spaceId: z.ZodOptional<z.ZodString>;
            until: z.ZodString;
        }, z.core.$strip>>>;
        sessionModel: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        description: z.ZodOptional<z.ZodString>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"agent.switch">;
    id: z.ZodString;
    provider: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>;
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
    fromProvider: z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
    toProvider: z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>;
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
        defaultProvider: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>>;
        defaultModel: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodString>>>;
        maxConcurrentRuns: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        limitPolicy: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            auto: "auto";
            manager: "manager";
            ask: "ask";
        }>>>;
        failoverOrder: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gemini: "gemini";
            "claude-session": "claude-session";
            copilot: "copilot";
            antigravity: "antigravity";
        }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>>>;
        loungeBreaks: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        preferCheapModels: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        idleLoungeMinutes: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        idleBehaviour: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            stayChance: z.ZodDefault<z.ZodNumber>;
            visitChance: z.ZodDefault<z.ZodNumber>;
            loungeChance: z.ZodDefault<z.ZodNumber>;
            minRollSeconds: z.ZodDefault<z.ZodNumber>;
            maxRollSeconds: z.ZodDefault<z.ZodNumber>;
            visitSeconds: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider.setKey">;
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
    }>;
    apiKey: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"provider.order">;
    order: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"customProvider.upsert">;
    provider: z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        id: z.ZodString;
        label: z.ZodString;
        engine: z.ZodEnum<{
            openai: "openai";
            anthropic: "anthropic";
        }>;
        baseUrl: z.ZodString;
        models: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"customProvider.remove">;
    id: z.ZodString;
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
    provider: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gemini: "gemini";
        "claude-session": "claude-session";
        copilot: "copilot";
        antigravity: "antigravity";
    }>, z.ZodType<`custom:${string}`, unknown, z.core.$ZodTypeInternals<`custom:${string}`, unknown>>]>>;
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
/** Global provider configuration the web needs. Never carries key values: only whether each is set. */
export interface ProviderConfigInfo {
    /** Custom (OpenAI-/Anthropic-compatible) providers in effect, without their keys. */
    customProviders: CustomProviderInfo[];
    /** The user's provider order, resolved over every provider in effect. */
    providerOrder: Provider[];
    /** Whether an API key is stored in AgenticView's config for each keyed built-in provider. */
    providerKeys: Record<KeyedProvider, boolean>;
    /** True when saved provider config differs from what this office started with (restart to apply). */
    restartNeeded?: boolean;
}
export interface Snapshot {
    spaceNames?: Record<string, string>;
    world: WorldInfo;
    agents: Agent[];
    /** Tasks on the wire carry an empty `log`; the persisted task keeps the full log. */
    tasks: Task[];
    providers: ProviderStatus[];
    /** What "Automatic" resolves to right now (first available provider), or null when none is. */
    autoProvider?: Provider | null;
    /** Provider config (custom providers, order, which keys are set). */
    providerConfig?: ProviderConfigInfo;
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
    /**
     * The office floor plan (layout as data). Absent from older servers: the web then falls back to
     * defaultLayout(worker count).
     */
    layout?: OfficeLayout;
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
}
/** The floor plan changed (rooms moved, added, removed or re-kinded): the full new layout. */
 | {
    type: "layout.updated";
    layout: OfficeLayout;
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
    providerConfig?: ProviderConfigInfo;
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
    opponentId: string;
    round: number;
    userMove: Match["moves"][0];
    agentMove: Match["moves"][1];
    winner: "you" | "agent" | null;
    score: {
        you: number;
        agent: number;
    };
    done: boolean;
}
/**
 * Agent auto-match about to be played. The scene walks `players[i]` from its
 * lounge seat `seatSpotIds[i]` to game spot `spotIds[i]` (LoungeLayout.gameSpots ids,
 * local to the lounge room), they play for `playMs`, then `game.result` with the same
 * match id follows and both return to their seats.
 */
 | {
    type: "game.started";
    matchId: string;
    players: [string, string];
    spotIds: [string, string];
    seatSpotIds: [string, string];
    playMs: number;
} | {
    type: "game.result";
    match: Match;
};
