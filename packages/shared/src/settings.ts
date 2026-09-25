import { z } from "zod";
import { ProviderSchema } from "./agent.js";

export const ProjectSettingsSchema = z.object({
  defaultProvider: ProviderSchema.nullable().default(null),
  defaultModel: z.string().nullable().default(null),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

const ProviderConfigSchema = z.object({ apiKey: z.string().optional(), model: z.string().optional() }).prefault({});

export const KnownProjectSchema = z.object({ path: z.string(), name: z.string(), lastOpened: z.string() });
export type KnownProject = z.infer<typeof KnownProjectSchema>;

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
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
