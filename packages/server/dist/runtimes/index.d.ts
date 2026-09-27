import { type CustomProviderConfig, type GlobalConfig, type Provider } from "@agenticview/shared";
import type { Runtime } from "./types.js";
import { type Which } from "./which.js";
export interface RuntimeFactoryOptions {
    bridgeUrl: () => string;
    which?: Which;
    checkTtlMs?: number;
    /** Fired when the number of connected Claude Code session workers changes. */
    onSessionWorkersChanged?: () => void;
}
/** Wrap a runtime so `check()` is cached for `ttlMs` (provider probes hit the filesystem / PATH). */
export declare function withCheckCache(runtime: Runtime, ttlMs: number): Runtime;
/** Path of the built stdio bridge next to this module (dist/bridge/stdioBridge.js). */
export declare function bridgeEntryPath(): string;
/** Runtime for one custom provider entry: Codex CLI for "openai" endpoints, the Agent SDK for "anthropic" ones. */
export declare function customRuntime(c: CustomProviderConfig, opts: Pick<RuntimeFactoryOptions, "bridgeUrl"> & {
    which: Which;
    bridgeEntry: string;
}): Runtime;
export declare function setCustomRuntimeFactory(map: Map<Provider, Runtime>, make: (provider: Provider) => Runtime): void;
/**
 * (Re)build the runtimes whose construction depends on the global config: the keyed built-ins
 * (claude, codex, gemini) and every custom provider. Runs in flight keep their old runtime object;
 * the next run uses the new one. Also refreshes the process-wide custom provider registry.
 */
export declare function applyProviderConfig(map: Map<Provider, Runtime>, cfg: GlobalConfig, overrides?: RuntimeFactoryOptions): void;
/** Build the provider map from global config. All providers are always registered; `check()` decides availability. */
export declare function createRuntimes(opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>>;
