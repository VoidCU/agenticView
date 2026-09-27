import { z } from "zod";
import { type CustomProviderRef, type Provider } from "./agent.js";
/**
 * Execution engine of a custom provider. No new agent loop: "openai" endpoints run through the Codex
 * CLI (a per-run model_providers overlay, Responses API), "anthropic" endpoints through the Claude
 * Agent SDK (ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY in the child env).
 */
export declare const CustomEngineSchema: z.ZodEnum<{
    openai: "openai";
    anthropic: "anthropic";
}>;
export type CustomEngine = z.infer<typeof CustomEngineSchema>;
export declare const CustomModelSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CustomModel = z.infer<typeof CustomModelSchema>;
/** A custom provider as stored in ~/.agenticview/config.json (providers.custom[]). */
export declare const CustomProviderConfigSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    label: z.ZodString;
    engine: z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
    }>;
    baseUrl: z.ZodString;
    models: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;
/** Wire form: never carries the key, only whether one is set. */
export declare const CustomProviderInfoSchema: z.ZodObject<{
    hasKey: z.ZodBoolean;
    id: z.ZodString;
    label: z.ZodString;
    engine: z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
    }>;
    baseUrl: z.ZodString;
    models: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type CustomProviderInfo = z.infer<typeof CustomProviderInfoSchema>;
/** Upsert payload from the settings form. `apiKey` undefined = keep, "" or null = clear, string = set. */
export declare const CustomProviderUpsertSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    id: z.ZodString;
    label: z.ZodString;
    engine: z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
    }>;
    baseUrl: z.ZodString;
    models: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    defaultModel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type CustomProviderUpsert = z.infer<typeof CustomProviderUpsertSchema>;
/** Built-in providers whose API key can be stored in AgenticView's config (the rest use a CLI login). */
export declare const KEYED_PROVIDERS: readonly ["claude", "codex", "gemini"];
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];
/** Child-process env variable each stored key is passed as. */
export declare const PROVIDER_KEY_ENV: Record<KeyedProvider, string>;
export declare function customRef(id: string): CustomProviderRef;
export declare function customSlug(p: CustomProviderRef): string;
export declare function toCustomInfo(c: CustomProviderConfig): CustomProviderInfo;
export declare function setCustomProviders(list: readonly (CustomProviderInfo | CustomProviderConfig)[]): void;
export declare function getCustomProviders(): readonly CustomProviderInfo[];
export declare function findCustomProvider(p: string | null | undefined): CustomProviderInfo | undefined;
/** True for a built-in provider or a custom one that is currently registered. */
export declare function isKnownProvider(p: string | null | undefined): p is Provider;
/** Display label for any provider id (custom ones by their configured label). */
export declare function providerLabelOf(p: string | null | undefined): string;
/** Every provider in effect: built-ins in PROVIDER_ORDER, then registered custom ones. */
export declare function allProviders(): Provider[];
/**
 * The user's provider order applied to the providers in effect: entries of `order` that exist, in that
 * order, then any provider the order does not mention (new ones) in their default position.
 * Drives Automatic, failover candidates and the header chips.
 */
export declare function orderedProviders(order: readonly string[] | null | undefined, available?: readonly Provider[]): Provider[];
