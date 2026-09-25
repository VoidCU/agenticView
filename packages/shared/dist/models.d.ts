import { z } from "zod";
import type { Provider } from "./agent.js";
/**
 * Reasoning effort, the union of what the providers accept:
 * - Claude Agent SDK `Options.effort`: low | medium | high | xhigh | max
 * - Codex `ThreadOptions.modelReasoningEffort` / `model_reasoning_effort`: minimal | low | medium | high | xhigh | max | ultra
 * - Gemini CLI: no effort control (hidden in the UI, ignored by the runtime).
 */
export declare const EFFORT_LEVELS: readonly ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export declare const EffortSchema: z.ZodEnum<{
    minimal: "minimal";
    low: "low";
    medium: "medium";
    high: "high";
    xhigh: "xhigh";
    max: "max";
    ultra: "ultra";
}>;
export type Effort = z.infer<typeof EffortSchema>;
export declare const EFFORT_LABELS: Record<Effort, string>;
export interface ModelOption {
    /** Value passed to the SDK/CLI. */
    id: string;
    label: string;
    /** Effort levels this model accepts; empty = no effort control. */
    efforts: readonly Effort[];
}
export interface ProviderModelCatalogue {
    /** Effort levels offered when the model is left at the provider default. */
    defaultEfforts: readonly Effort[];
    models: readonly ModelOption[];
    /** Whether a free-text model id is meaningful for this provider. */
    allowCustom: boolean;
}
/**
 * Per-provider model catalogue. Claude uses the Agent SDK aliases so picks stay current as
 * models roll forward. Codex ids and effort sets come from the codex CLI's model list
 * (~/.codex/models_cache.json, codex-cli 0.156). Gemini ids/aliases come from the Gemini
 * CLI's config/models.js (0.26); the CLI has no thinking/effort flag.
 */
export declare const MODEL_CATALOGUE: Record<Provider, ProviderModelCatalogue>;
export declare function findModel(provider: Provider, model: string | null | undefined): ModelOption | undefined;
/**
 * Effort levels selectable for a provider + model. Unknown (custom) models get the provider's
 * default set, since the SDK/CLI falls back or rejects on its own.
 */
export declare function effortsFor(provider: Provider, model: string | null | undefined): readonly Effort[];
/** The effort to actually send: null when the model does not support the requested level. */
export declare function effectiveEffort(provider: Provider, model: string | null | undefined, effort: Effort | null | undefined): Effort | null;
/** Short label for a model id ("Opus", "GPT-6-Sol", or the raw custom id). */
export declare function modelLabel(provider: Provider, model: string | null | undefined): string | null;
