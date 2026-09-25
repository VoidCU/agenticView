import { fileURLToPath } from "node:url";
import type { Provider, ProviderStatus } from "@agenticview/shared";
import type { Runtime } from "./types.js";
import { ClaudeRuntime } from "./claude.js";
import { CodexRuntime } from "./codex.js";
import { AntigravityRuntime } from "./antigravity.js";
import { GeminiRuntime } from "./gemini.js";
import { SessionRuntime } from "./session.js";
import { which as defaultWhich, type Which } from "./which.js";
import { readGlobalConfig } from "../world.js";

export interface RuntimeFactoryOptions {
  bridgeUrl: () => string;
  which?: Which;
  checkTtlMs?: number;
  /** Fired when the number of connected Claude Code session workers changes. */
  onSessionWorkersChanged?: () => void;
}

/** Wrap a runtime so `check()` is cached for `ttlMs` (provider probes hit the filesystem / PATH). */
export function withCheckCache(runtime: Runtime, ttlMs: number): Runtime {
  let cached: { at: number; value: ProviderStatus } | undefined;
  return {
    provider: runtime.provider,
    async check() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value;
      const value = await runtime.check();
      cached = { at: Date.now(), value };
      return value;
    },
    run: (req, sink, signal) => runtime.run(req, sink, signal),
  };
}

/** Path of the built stdio bridge next to this module (dist/bridge/stdioBridge.js). */
export function bridgeEntryPath(): string {
  return fileURLToPath(new URL("../bridge/stdioBridge.js", import.meta.url));
}

/** Build the provider map from global config. All providers are always registered; `check()` decides availability. */
export async function createRuntimes(opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>> {
  const cfg = await readGlobalConfig();
  const which = opts.which ?? defaultWhich;
  const ttl = opts.checkTtlMs ?? 60_000;
  const bridgeEntry = bridgeEntryPath();
  const map = new Map<Provider, Runtime>();
  map.set("claude", withCheckCache(new ClaudeRuntime({ apiKey: cfg.providers.claude.apiKey }), ttl));
  // Not cached: availability is "a worker polled recently", which changes second to second.
  map.set("claude-session", new SessionRuntime({ onWorkersChanged: opts.onSessionWorkersChanged }));
  map.set("codex", withCheckCache(new CodexRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.codex.apiKey, which }), ttl));
  map.set("antigravity", withCheckCache(new AntigravityRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, which }), ttl));
  map.set("gemini", withCheckCache(new GeminiRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.gemini.apiKey, which }), ttl));
  return map;
}
