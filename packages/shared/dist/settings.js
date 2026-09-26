import { z } from "zod";
import { ProviderSchema } from "./agent.js";
export const ProjectSettingsSchema = z.object({
    defaultProvider: ProviderSchema.nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
    /** How to handle an agent whose provider hits a quota/rate-limit: prompt the user ('ask') or revive automatically ('auto'). */
    limitPolicy: z.enum(["ask", "auto"]).default("ask"),
    /** Allow the manager to suggest lounge breaks when the project is quiet. */
    loungeBreaks: z.boolean().default(true),
    /** When true (default), create_agent without an explicit provider/model picks the cheapest available choice. */
    preferCheapModels: z.boolean().default(true),
});
const ProviderConfigSchema = z.object({ apiKey: z.string().optional(), model: z.string().optional() }).prefault({});
export const KnownProjectSchema = z.object({ path: z.string(), name: z.string(), lastOpened: z.string() });
export const GlobalConfigSchema = z.object({
    /** null = Automatic: the first available provider in PROVIDER_ORDER. */
    defaultProvider: ProviderSchema.nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
    providers: z
        .object({ claude: ProviderConfigSchema, codex: ProviderConfigSchema, antigravity: ProviderConfigSchema, gemini: ProviderConfigSchema })
        .prefault({}),
    knownProjects: z.array(KnownProjectSchema).default([]),
});
//# sourceMappingURL=settings.js.map