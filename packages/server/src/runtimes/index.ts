import type { Provider } from "@agenticview/shared";
import type { Runtime } from "./types.js";
import { ClaudeRuntime } from "./claude.js";
import { readGlobalConfig } from "../world.js";

export interface RuntimeFactoryOptions {
  bridgeUrl: () => string;
}

/** Build the provider map from global config. Codex and Gemini are added in Task 15. */
export async function createRuntimes(_opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>> {
  const cfg = await readGlobalConfig();
  const map = new Map<Provider, Runtime>();
  map.set("claude", new ClaudeRuntime({ apiKey: cfg.providers.claude.apiKey }));
  return map;
}
