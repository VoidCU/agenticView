import { z } from "zod";
export declare const ProjectSettingsSchema: z.ZodObject<{
    defaultProvider: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        claude: "claude";
        "claude-session": "claude-session";
        codex: "codex";
        gemini: "gemini";
    }>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
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
