import type { Provider } from "@agenticview/shared";
import type { Runtime } from "./types.js";
export interface RuntimeFactoryOptions {
    bridgeUrl: () => string;
}
/** Build the provider map from global config. Codex and Gemini are added in Task 15. */
export declare function createRuntimes(_opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>>;
