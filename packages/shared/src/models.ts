import { z } from "zod";
import type { Provider } from "./agent.js";

/**
 * Reasoning effort, the union of what the providers accept:
 * - Claude Agent SDK `Options.effort`: low | medium | high | xhigh | max
 * - Codex `ThreadOptions.modelReasoningEffort` / `model_reasoning_effort`: minimal | low | medium | high | xhigh | max | ultra
 * - Gemini CLI: no effort control (hidden in the UI, ignored by the runtime).
 */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const EffortSchema = z.enum(EFFORT_LEVELS);
export type Effort = z.infer<typeof EffortSchema>;

export const EFFORT_LABELS: Record<Effort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
};

export interface ModelOption {
  /** Value passed to the SDK/CLI. */
  id: string;
  label: string;
  /** Effort levels this model accepts; empty = no effort control. */
  efforts: readonly Effort[];
}

const CLAUDE_EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
// "ultra" is in the SDK type and the local model cache, but the Codex server rejected it in a live run (codex-cli 0.156.0), so it is not offered.
const CODEX_FULL: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
const CODEX_MAX: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

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
export const MODEL_CATALOGUE: Record<Provider, ProviderModelCatalogue> = {
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

export function findModel(provider: Provider, model: string | null | undefined): ModelOption | undefined {
  if (!model) return undefined;
  return MODEL_CATALOGUE[provider].models.find((m) => m.id === model);
}

/**
 * Effort levels selectable for a provider + model. Unknown (custom) models get the provider's
 * default set, since the SDK/CLI falls back or rejects on its own.
 */
export function effortsFor(provider: Provider, model: string | null | undefined): readonly Effort[] {
  const cat = MODEL_CATALOGUE[provider];
  if (!model) return cat.defaultEfforts;
  return findModel(provider, model)?.efforts ?? cat.defaultEfforts;
}

/** The effort to actually send: null when the model does not support the requested level. */
export function effectiveEffort(provider: Provider, model: string | null | undefined, effort: Effort | null | undefined): Effort | null {
  if (!effort) return null;
  return effortsFor(provider, model).includes(effort) ? effort : null;
}

/** Short label for a model id ("Opus", "GPT-6-Sol", or the raw custom id). */
export function modelLabel(provider: Provider, model: string | null | undefined): string | null {
  if (!model) return null;
  const m = findModel(provider, model);
  return m ? m.label.replace(/\s*\(.*\)$/, "") : model;
}
