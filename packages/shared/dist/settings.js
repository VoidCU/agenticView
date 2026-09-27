import { z } from "zod";
import { ProviderSchema } from "./agent.js";
import { CustomProviderConfigSchema } from "./providers.js";
/** Default provider order for automatic failover when a run fails or crashes. */
export const DEFAULT_FAILOVER_ORDER = ["codex", "copilot", "antigravity", "claude-session"];
/** Default model per provider used when the failover policy switches an agent. */
export const FAILOVER_PROVIDER_MODELS = {
    codex: "gpt-6-luna",
    copilot: "auto",
    antigravity: "gemini-3.8-flash-high",
    "claude-session": "sonnet",
};
/**
 * Idle behaviour of workers (server-local randomness, never a model call). After `idleLoungeMinutes`
 * idle, a worker rolls every `minRollSeconds`..`maxRollSeconds`: stay at (or return to) a desk, take a
 * brief visit to a colleague or the whiteboard, or lounge. The chances are relative weights.
 */
export const IdleBehaviourSchema = z.object({
    stayChance: z.number().min(0).max(1).default(0.4),
    visitChance: z.number().min(0).max(1).default(0.25),
    loungeChance: z.number().min(0).max(1).default(0.35),
    minRollSeconds: z.number().int().min(5).max(3600).default(120),
    maxRollSeconds: z.number().int().min(5).max(3600).default(240),
    /** How long a visit lasts before the worker walks back to its desk. */
    visitSeconds: z.number().int().min(5).max(600).default(45),
});
export const DEFAULT_IDLE_BEHAVIOUR = IdleBehaviourSchema.parse({});
export const ProjectSettingsSchema = z.object({
    defaultProvider: ProviderSchema.nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
    /**
     * How to handle an agent whose provider hits a quota/rate-limit or crash: prompt the user ('ask'),
     * revive automatically ('auto'), or revive automatically AND brief the Manager, who reviews the
     * placement on its next request ('manager').
     */
    limitPolicy: z.enum(["ask", "auto", "manager"]).default("ask"),
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
    /** Minutes a worker must be idle before its idle rolls (desk / visit / lounge) start (0 = off). */
    idleLoungeMinutes: z.number().int().min(0).max(60).default(3),
    /** Idle roll chances and timing (see IdleBehaviourSchema); omitted = DEFAULT_IDLE_BEHAVIOUR. */
    idleBehaviour: IdleBehaviourSchema.optional(),
});
const ProviderConfigSchema = z.object({ apiKey: z.string().optional(), model: z.string().optional() }).prefault({});
export const KnownProjectSchema = z.object({ path: z.string(), name: z.string(), lastOpened: z.string() });
export const GlobalConfigSchema = z.object({
    /** null = Automatic: the first available provider in PROVIDER_ORDER. */
    defaultProvider: ProviderSchema.nullable().default(null),
    defaultModel: z.string().nullable().default(null),
    maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
    providers: z
        .object({
        claude: ProviderConfigSchema,
        codex: ProviderConfigSchema,
        copilot: ProviderConfigSchema,
        antigravity: ProviderConfigSchema,
        gemini: ProviderConfigSchema,
        /** User-added OpenAI-/Anthropic-compatible endpoints (provider id `custom:<id>`). Invalid entries are dropped. */
        custom: z
            .array(z.unknown())
            .default([])
            .transform((list) => {
            const out = [];
            for (const raw of list) {
                const r = CustomProviderConfigSchema.safeParse(raw);
                if (r.success && !out.some((c) => c.id === r.data.id))
                    out.push(r.data);
            }
            return out;
        }),
    })
        .prefault({}),
    /**
     * The user's provider order (built-in and custom ids): Automatic picks the first available one, failover
     * tries them in this order, and the header shows chips in this order. Unlisted providers follow in their
     * default position. Empty = the default order.
     */
    providerOrder: z.array(z.string()).default([]),
    knownProjects: z.array(KnownProjectSchema).default([]),
});
//# sourceMappingURL=settings.js.map