import { z } from "zod";
import { CUSTOM_PROVIDER_PREFIX, PROVIDER_LABELS, PROVIDER_ORDER, isBuiltinProvider, isCustomProvider, } from "./agent.js";
/**
 * Execution engine of a custom provider. No new agent loop: "openai" endpoints run through the Codex
 * CLI (a per-run model_providers overlay, Responses API), "anthropic" endpoints through the Claude
 * Agent SDK (ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY in the child env).
 */
export const CustomEngineSchema = z.enum(["openai", "anthropic"]);
export const CustomModelSchema = z.object({
    id: z.string().trim().min(1).max(200),
    label: z.string().trim().max(80).optional(),
});
/** Custom provider slug (kept local: agent.ts is mid-initialisation when this module first loads, via models.ts). */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const customFields = {
    /** Slug; the provider's id everywhere else is `custom:<id>`. */
    id: z.string().regex(SLUG_RE, "lowercase letters, digits and dashes (max 32)"),
    label: z.string().trim().min(1).max(40),
    engine: CustomEngineSchema,
    baseUrl: z.string().trim().url().max(500),
    models: z.array(CustomModelSchema).max(50).default([]),
    defaultModel: z.string().trim().max(200).nullable().default(null),
};
/** A custom provider as stored in ~/.agenticview/config.json (providers.custom[]). */
export const CustomProviderConfigSchema = z.object({ ...customFields, apiKey: z.string().max(2000).optional() });
/** Wire form: never carries the key, only whether one is set. */
export const CustomProviderInfoSchema = z.object({ ...customFields, hasKey: z.boolean() });
/** Upsert payload from the settings form. `apiKey` undefined = keep, "" or null = clear, string = set. */
export const CustomProviderUpsertSchema = z.object({ ...customFields, apiKey: z.string().max(2000).nullable().optional() });
/** Built-in providers whose API key can be stored in AgenticView's config (the rest use a CLI login). */
export const KEYED_PROVIDERS = ["claude", "codex", "gemini"];
/** Child-process env variable each stored key is passed as. */
export const PROVIDER_KEY_ENV = { claude: "ANTHROPIC_API_KEY", codex: "CODEX_API_KEY", gemini: "GEMINI_API_KEY" };
export function customRef(id) {
    return `${CUSTOM_PROVIDER_PREFIX}${id}`;
}
export function customSlug(p) {
    return p.slice(CUSTOM_PROVIDER_PREFIX.length);
}
export function toCustomInfo(c) {
    const { apiKey, ...rest } = c;
    return { ...rest, hasKey: Boolean(apiKey) };
}
// Process-wide registry of the custom providers in effect. The server sets it from the global config at
// start; the web sets it from each snapshot. Label/catalogue helpers read it so every surface sees them.
let registry = [];
export function setCustomProviders(list) {
    registry = list.map((c) => ("hasKey" in c ? { ...c } : toCustomInfo(c)));
}
export function getCustomProviders() {
    return registry;
}
export function findCustomProvider(p) {
    if (!isCustomProvider(p))
        return undefined;
    const slug = customSlug(p);
    return registry.find((c) => c.id === slug);
}
/** True for a built-in provider or a custom one that is currently registered. */
export function isKnownProvider(p) {
    return isBuiltinProvider(p) || Boolean(findCustomProvider(p));
}
/** Display label for any provider id (custom ones by their configured label). */
export function providerLabelOf(p) {
    if (!p)
        return "";
    if (isBuiltinProvider(p))
        return PROVIDER_LABELS[p];
    return findCustomProvider(p)?.label ?? p.replace(CUSTOM_PROVIDER_PREFIX, "");
}
/** Every provider in effect: built-ins in PROVIDER_ORDER, then registered custom ones. */
export function allProviders() {
    return [...PROVIDER_ORDER, ...registry.map((c) => customRef(c.id))];
}
/**
 * The user's provider order applied to the providers in effect: entries of `order` that exist, in that
 * order, then any provider the order does not mention (new ones) in their default position.
 * Drives Automatic, failover candidates and the header chips.
 */
export function orderedProviders(order, available = allProviders()) {
    const known = new Set(available);
    const out = [];
    for (const p of order ?? [])
        if (known.has(p) && !out.includes(p))
            out.push(p);
    for (const p of available)
        if (!out.includes(p))
            out.push(p);
    return out;
}
//# sourceMappingURL=providers.js.map