import { z } from "zod";
/**
 * Reasoning effort, the union of what the providers accept:
 * - Claude Agent SDK `Options.effort`: low | medium | high | xhigh | max
 * - Codex `ThreadOptions.modelReasoningEffort` / `model_reasoning_effort`: minimal | low | medium | high | xhigh | max | ultra
 * - Gemini CLI: no effort control (hidden in the UI, ignored by the runtime).
 */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export const EffortSchema = z.enum(EFFORT_LEVELS);
export const EFFORT_LABELS = {
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "X-High",
    max: "Max",
    ultra: "Ultra",
};
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CODEX_FULL = ["low", "medium", "high", "xhigh", "max", "ultra"];
const CODEX_MAX = ["low", "medium", "high", "xhigh", "max"];
/**
 * Per-provider model catalogue. Claude uses the Agent SDK aliases so picks stay current as
 * models roll forward. Codex ids and effort sets come from the codex CLI's model list
 * (~/.codex/models_cache.json, codex-cli 0.156). Gemini ids/aliases come from the Gemini
 * CLI's config/models.js (0.26); the CLI has no thinking/effort flag.
 */
export const MODEL_CATALOGUE = {
    claude: {
        defaultEfforts: CLAUDE_EFFORTS,
        allowCustom: true,
        models: [
            { id: "opus", label: "Opus (latest, Opus 5.5)", efforts: CLAUDE_EFFORTS },
            { id: "sonnet", label: "Sonnet (latest, Sonnet 5)", efforts: CLAUDE_EFFORTS },
            { id: "haiku", label: "Haiku (latest, Haiku 4.5)", efforts: [] },
            { id: "fable", label: "Fable (latest, Fable 5.1)", efforts: CLAUDE_EFFORTS },
        ],
    },
    "claude-session": {
        // The worker session keeps its own model; effort is guidance for how thorough to be.
        defaultEfforts: CLAUDE_EFFORTS,
        allowCustom: false,
        models: [],
    },
    codex: {
        defaultEfforts: ["low", "medium", "high"],
        allowCustom: true,
        models: [
            { id: "gpt-6-astra", label: "GPT-6-Astra", efforts: CODEX_FULL },
            { id: "gpt-6-sol", label: "GPT-6-Sol", efforts: CODEX_FULL },
            { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: CODEX_MAX },
            { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: CODEX_FULL },
            { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", efforts: CODEX_FULL },
            { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", efforts: CODEX_MAX },
            { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"] },
        ],
    },
    gemini: {
        defaultEfforts: [],
        allowCustom: true,
        models: [
            { id: "auto", label: "Auto (CLI routing)", efforts: [] },
            { id: "pro", label: "Pro (alias)", efforts: [] },
            { id: "flash", label: "Flash (alias)", efforts: [] },
            { id: "flash-lite", label: "Flash-Lite (alias)", efforts: [] },
            { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)", efforts: [] },
            { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", efforts: [] },
            { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", efforts: [] },
            { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", efforts: [] },
        ],
    },
};
export function findModel(provider, model) {
    if (!model)
        return undefined;
    return MODEL_CATALOGUE[provider].models.find((m) => m.id === model);
}
/**
 * Effort levels selectable for a provider + model. Unknown (custom) models get the provider's
 * default set, since the SDK/CLI falls back or rejects on its own.
 */
export function effortsFor(provider, model) {
    const cat = MODEL_CATALOGUE[provider];
    if (!model)
        return cat.defaultEfforts;
    return findModel(provider, model)?.efforts ?? cat.defaultEfforts;
}
/** The effort to actually send: null when the model does not support the requested level. */
export function effectiveEffort(provider, model, effort) {
    if (!effort)
        return null;
    return effortsFor(provider, model).includes(effort) ? effort : null;
}
/** Short label for a model id ("Opus", "GPT-6-Sol", or the raw custom id). */
export function modelLabel(provider, model) {
    if (!model)
        return null;
    const m = findModel(provider, model);
    return m ? m.label.replace(/\s*\(.*\)$/, "") : model;
}
//# sourceMappingURL=models.js.map