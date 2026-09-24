import { ClaudeRuntime } from "./claude.js";
import { readGlobalConfig } from "../world.js";
/** Build the provider map from global config. Codex and Gemini are added in Task 15. */
export async function createRuntimes(_opts) {
    const cfg = await readGlobalConfig();
    const map = new Map();
    map.set("claude", new ClaudeRuntime({ apiKey: cfg.providers.claude.apiKey }));
    return map;
}
//# sourceMappingURL=index.js.map