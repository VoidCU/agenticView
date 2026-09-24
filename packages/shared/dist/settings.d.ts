import { z } from "zod";
export declare const ProjectSettingsSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodNullable<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    defaultProvider: "claude" | "codex" | "gemini" | null;
    defaultModel: string | null;
    maxConcurrentRuns: number;
}, {
    defaultProvider?: "claude" | "codex" | "gemini" | null | undefined;
    defaultModel?: string | null | undefined;
    maxConcurrentRuns?: number | undefined;
}>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export declare const KnownProjectSchema: z.ZodObject<{
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
}>;
export type KnownProject = z.infer<typeof KnownProjectSchema>;
export declare const GlobalConfigSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodEnum<["claude", "codex", "gemini"]>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
    providers: z.ZodDefault<z.ZodObject<{
        claude: z.ZodDefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }>>;
        codex: z.ZodDefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }>>;
        gemini: z.ZodDefault<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }, {
            model?: string | undefined;
            apiKey?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        claude: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
        codex: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
        gemini: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
    }, {
        claude?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
        codex?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
        gemini?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
    }>>;
    knownProjects: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    defaultProvider: "claude" | "codex" | "gemini";
    defaultModel: string | null;
    maxConcurrentRuns: number;
    providers: {
        claude: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
        codex: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
        gemini: {
            model?: string | undefined;
            apiKey?: string | undefined;
        };
    };
    knownProjects: {
        path: string;
        name: string;
        lastOpened: string;
    }[];
}, {
    defaultProvider?: "claude" | "codex" | "gemini" | undefined;
    defaultModel?: string | null | undefined;
    maxConcurrentRuns?: number | undefined;
    providers?: {
        claude?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
        codex?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
        gemini?: {
            model?: string | undefined;
            apiKey?: string | undefined;
        } | undefined;
    } | undefined;
    knownProjects?: {
        path: string;
        name: string;
        lastOpened: string;
    }[] | undefined;
}>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
