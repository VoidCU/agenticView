import { fileURLToPath } from "node:url";
import { customRef, isCustomProvider, setCustomProviders, type CustomProviderConfig, type GlobalConfig, type Provider, type ProviderStatus } from "@agenticview/shared";
import type { Runtime } from "./types.js";
import { ClaudeRuntime } from "./claude.js";
import { CodexRuntime } from "./codex.js";
import { AntigravityRuntime } from "./antigravity.js";
import { CopilotRuntime } from "./copilot.js";
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

/** Runtime for one custom provider entry: Codex CLI for "openai" endpoints, the Agent SDK for "anthropic" ones. */
export function customRuntime(c: CustomProviderConfig, opts: Pick<RuntimeFactoryOptions, "bridgeUrl"> & { which: Which; bridgeEntry: string }): Runtime {
  const provider = customRef(c.id);
  const endpoint = { provider, name: c.label, baseUrl: c.baseUrl, apiKey: c.apiKey, defaultModel: c.defaultModel };
  return c.engine === "anthropic"
    ? new ClaudeRuntime({ custom: endpoint })
    : new CodexRuntime({ bridgeEntry: opts.bridgeEntry, bridgeUrl: opts.bridgeUrl, which: opts.which, custom: endpoint });
}

// Factory options per runtime map, so a settings change can rebuild the keyed/custom runtimes in place.
const factoryOptions = new WeakMap<Map<Provider, Runtime>, RuntimeFactoryOptions>();

/**
 * (Re)build the runtimes whose construction depends on the global config: the keyed built-ins
 * (claude, codex, gemini) and every custom provider. Runs in flight keep their old runtime object;
 * the next run uses the new one. Also refreshes the process-wide custom provider registry.
 */
export function applyProviderConfig(map: Map<Provider, Runtime>, cfg: GlobalConfig, overrides?: RuntimeFactoryOptions): void {
  setCustomProviders(cfg.providers.custom);
  const opts = overrides ?? factoryOptions.get(map);
  if (!opts) return; // a hand-built map (tests): only the registry changes
  const which = opts.which ?? defaultWhich;
  const ttl = opts.checkTtlMs ?? 60_000;
  const bridgeEntry = bridgeEntryPath();
  map.set("claude", withCheckCache(new ClaudeRuntime({ apiKey: cfg.providers.claude.apiKey }), ttl));
  map.set("codex", withCheckCache(new CodexRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.codex.apiKey, which }), ttl));
  map.set("gemini", withCheckCache(new GeminiRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, apiKey: cfg.providers.gemini.apiKey, which }), ttl));
  for (const p of [...map.keys()]) if (isCustomProvider(p)) map.delete(p);
  for (const c of cfg.providers.custom) map.set(customRef(c.id), withCheckCache(customRuntime(c, { bridgeUrl: opts.bridgeUrl, which, bridgeEntry }), ttl));
}

/** Build the provider map from global config. All providers are always registered; `check()` decides availability. */
export async function createRuntimes(opts: RuntimeFactoryOptions): Promise<Map<Provider, Runtime>> {
  const cfg = await readGlobalConfig();
  const which = opts.which ?? defaultWhich;
  const ttl = opts.checkTtlMs ?? 60_000;
  const bridgeEntry = bridgeEntryPath();
  const map = new Map<Provider, Runtime>();
  // Not cached: availability is "a worker polled recently", which changes second to second.
  map.set("claude-session", new SessionRuntime({ onWorkersChanged: opts.onSessionWorkersChanged }));
  map.set("copilot", withCheckCache(new CopilotRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, which }), ttl));
  map.set("antigravity", withCheckCache(new AntigravityRuntime({ bridgeEntry, bridgeUrl: opts.bridgeUrl, which }), ttl));
  factoryOptions.set(map, opts);
  applyProviderConfig(map, cfg);
  return map;
}
