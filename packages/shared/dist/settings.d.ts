import { z } from "zod";
import { ProviderSchema } from "./agent.js";
/** Default provider order for automatic failover when a run fails or crashes. */
export declare const DEFAULT_FAILOVER_ORDER: readonly ["codex", "antigravity", "claude-session"];
/** Default model per provider used when the failover policy switches an agent. */
export declare const FAILOVER_PROVIDER_MODELS: Partial<Record<z.infer<typeof ProviderSchema>, string>>;
/**
 * Idle behaviour of workers (server-local randomness, never a model call). After `idleLoungeMinutes`
 * idle, a worker rolls every `minRollSeconds`..`maxRollSeconds`: stay at (or return to) a desk, take a
 * brief visit to a colleague or the whiteboard, or lounge. The chances are relative weights.
 */
export declare const IdleBehaviourSchema: z.ZodObject<{
    stayChance: z.ZodDefault<z.ZodNumber>;
    visitChance: z.ZodDefault<z.ZodNumber>;
    loungeChance: z.ZodDefault<z.ZodNumber>;
    minRollSeconds: z.ZodDefault<z.ZodNumber>;
    maxRollSeconds: z.ZodDefault<z.ZodNumber>;
    visitSeconds: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type IdleBehaviour = z.infer<typeof IdleBehaviourSchema>;
export declare const DEFAULT_IDLE_BEHAVIOUR: IdleBehaviour;
export declare const ProjectSettingsSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
    limitPolicy: z.ZodDefault<z.ZodEnum<{
        auto: "auto";
        manager: "manager";
        ask: "ask";
    }>>;
    failoverOrder: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>>;
    loungeBreaks: z.ZodDefault<z.ZodBoolean>;
    preferCheapModels: z.ZodDefault<z.ZodBoolean>;
    idleLoungeMinutes: z.ZodDefault<z.ZodNumber>;
    idleBehaviour: z.ZodOptional<z.ZodObject<{
        stayChance: z.ZodDefault<z.ZodNumber>;
        visitChance: z.ZodDefault<z.ZodNumber>;
        loungeChance: z.ZodDefault<z.ZodNumber>;
        minRollSeconds: z.ZodDefault<z.ZodNumber>;
        maxRollSeconds: z.ZodDefault<z.ZodNumber>;
        visitSeconds: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export declare const KnownProjectSchema: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
    lastOpened: z.ZodString;
}, z.core.$strip>;
export type KnownProject = z.infer<typeof KnownProjectSchema>;
export declare const GlobalConfigSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        antigravity: "antigravity";
        gemini: "gemini";
    }>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
    providers: z.ZodPrefault<z.ZodObject<{
        claude: z.ZodPrefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        codex: z.ZodPrefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        antigravity: z.ZodPrefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        gemini: z.ZodPrefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    knownProjects: z.ZodDefault<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        name: z.ZodString;
        lastOpened: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
