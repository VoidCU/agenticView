import type { Provider } from "@agenticview/shared";
import type { Runtime } from "./types.js";
import { type Which } from "./which.js";
export interface RuntimeFactoryOptions {
    bridgeUrl: () => string;
    which?: Which;
    checkTtlMs?: number;
}
/** Wrap a runtime so `check()` is cached for `ttlMs` (provider probes hit the filesystem / PATH). */
export declare function withCheckCache(runtime: Runtime, ttlMs: number): Runtime;
/** Path of the built stdio bridge next to this module (dist/bridge/stdioBridge.js). */
export declare function bridgeEntryPath(): string;
/** Build the provider map from global config. All three providers are always registered; `check()` decides availability. */
export declare function createRuntimes(opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>>;
