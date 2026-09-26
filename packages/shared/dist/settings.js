import { z } from "zod";
import { ProviderSchema } from "./agent.js";
/** Default provider order for automatic failover when a run fails or crashes. */
export const DEFAULT_FAILOVER_ORDER = ["codex", "antigravity", "claude-session"];
/** Default model per provider used when the failover policy switches an agent. */
export const FAILOVER_PROVIDER_MODELS = {
    codex: "gpt-6-luna",
    antigravity: "gemini-3.8-flash-high",
    "claude-session": "sonnet",
};
export const ProjectSettingsSchema = z.object({
    defaultProvider: ProviderSchema.nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
    /** How to handle an agent whose provider hits a quota/rate-limit or crash: prompt the user ('ask') or revive automatically ('auto'). */
    limitPolicy: z.enum(["ask", "auto"]).default("ask"),
    /**
     * Ordered list of providers to try when a run fails (quota, rate-limit, or crash).
     * The policy picks the first provider after the current one in this list that is
     * available and not limited.  Empty list disables automatic failover.
     */
    failoverOrder: z.array(ProviderSchema).default([...DEFAULT_FAILOVER_ORDER]),
    /** Allow the manager to suggest lounge breaks when the project is quiet. */
    loungeBreaks: z.boolean().default(true),
    /** When true (default), create_agent without an explicit provider/model picks the cheapest available choice. */
    preferCheapModels: z.boolean().default(true),
    /** Minutes a worker must be idle before it enters the lounge (0 = off). */
    idleLoungeMinutes: z.number().int().min(0).max(60).default(3),
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