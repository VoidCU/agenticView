import { fileURLToPath } from "node:url";
import { ClaudeRuntime } from "./claude.js";
import { CodexRuntime } from "./codex.js";
import { GeminiRuntime } from "./gemini.js";
import { which as defaultWhich } from "./which.js";
import { readGlobalConfig } from "../world.js";
/** Wrap a runtime so `check()` is cached for `ttlMs` (provider probes hit the filesystem / PATH). */
export function withCheckCache(runtime, ttlMs) {
    let cached;
    return {
        provider: runtime.provider,
        async check() {
            if (cached && Date.now() - cached.at < ttlMs)
                return cached.value;
            const value = await runtime.check();
            cached = { at: Date.now(), value };
            return value;
        },
        run: (req, sink, signal) => runtime.run(req, sink, signal),
    };
}
/** Path of the built stdio bridge next to this module (dist/bridge/stdioBridge.js). */
export function bridgeEntryPath() {
    return fileURLToPath(new URL("../bridge/stdioBridge.js", import.meta.url));
}
/** Build the provider map from global config. All three providers are always registered; `check()` decides availability. */
export async function createRuntimes(opts) {
    const cfg = await readGlobalConfig();
    const which = opts.which ?? defaultWhich;
    const ttl = opts.checkTtlMs ?? 60_000;
    const bridgeEntry = bridgeEntryPath();
    const map = new Map();
    map.set("claude", withCheckCache(new ClaudeRuntime({ apiKey: cfg.providers.claude.apiKey }), ttl));
    map.set("codex", withCheckCache(new CodexRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.codex.apiKey, which }), ttl));
    map.set("gemini", withCheckCache(new GeminiRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.gemini.apiKey, which }), ttl));
    return map;
}
//# sourceMappingURL=index.js.map