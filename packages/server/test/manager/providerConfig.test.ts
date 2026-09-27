import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCustomProviders, type Provider, type ServerMessage } from "@agenticview/shared";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { Runtime } from "../../src/runtimes/types.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { EventBus } from "../../src/events/bus.js";
import { createWorld, globalConfigPath, readGlobalConfig } from "../../src/world.js";

let home: string;
let proj: string;
const savedHome = process.env.AGENTICVIEW_HOME;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "av-home-"));
  proj = await mkdtemp(join(tmpdir(), "av-proj-"));
  process.env.AGENTICVIEW_HOME = home;
});
afterEach(async () => {
  process.env.AGENTICVIEW_HOME = savedHome;
  setCustomProviders([]);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function setup() {
  const runtimes = new Map<Provider, Runtime>([["claude", new FakeRuntime(async function* () {})], ["codex", new FakeRuntime(async function* () {}, "codex")]]);
  const bus = new EventBus();
  const msgs: ServerMessage[] = [];
  bus.on((m) => msgs.push(m));
  const world = await createWorld({ kind: "project", projectPath: proj }, { runtimes, bus, toolRegistry: new ToolRegistry(), bridgeUrl: () => "http://127.0.0.1:0" });
  return { world, msgs, runtimes };
}

describe("provider config (keys, custom providers, order)", () => {
  it("stores keys in the global config but only ever sends set/not-set to clients", async () => {
    const { world, msgs } = await setup();
    await world.setProviderKey("gemini", "  gm-secret-123  ");
    await world.upsertCustomProvider({ id: "local", label: "Local", engine: "openai", baseUrl: "http://127.0.0.1:1234/v1", models: [{ id: "qwen3" }], defaultModel: "qwen3", apiKey: "cu-secret-456" });
    const cfg = await readGlobalConfig();
    expect(cfg.providers.gemini.apiKey).toBe("gm-secret-123");
    expect(cfg.providers.custom[0]!.apiKey).toBe("cu-secret-456");

    const snap = await world.snapshot();
    expect(snap.providerConfig?.providerKeys).toEqual({ claude: false, codex: false, gemini: true });
    expect(snap.providerConfig?.customProviders[0]).toMatchObject({ id: "local", hasKey: true });
    expect(snap.providerConfig?.providerOrder).toContain("custom:local");
    const wire = JSON.stringify([snap, msgs]);
    expect(wire).not.toContain("gm-secret-123");
    expect(wire).not.toContain("cu-secret-456");
    // The custom provider shows up as a provider status too.
    expect(snap.providers.map((p) => p.provider)).toContain("custom:local");
  });

  it("editing a custom provider without a key keeps the stored key; null clears it; remove drops it from the order", async () => {
    const { world } = await setup();
    const base = { id: "px", label: "Proxy", engine: "anthropic" as const, baseUrl: "https://proxy.example", models: [], defaultModel: null };
    await world.upsertCustomProvider({ ...base, apiKey: "k1" });
    await world.upsertCustomProvider({ ...base, label: "Proxy 2" });
    let cfg = await readGlobalConfig();
    expect(cfg.providers.custom).toHaveLength(1);
    expect(cfg.providers.custom[0]).toMatchObject({ label: "Proxy 2", apiKey: "k1" });
    await world.upsertCustomProvider({ ...base, apiKey: null });
    cfg = await readGlobalConfig();
    expect(cfg.providers.custom[0]!.apiKey).toBeUndefined();

    await world.setProviderOrder(["custom:px", "codex", "bogus"]);
    cfg = await readGlobalConfig();
    expect(cfg.providerOrder).toEqual(["custom:px", "codex"]);
    await world.removeCustomProvider("px");
    cfg = await readGlobalConfig();
    expect(cfg.providers.custom).toEqual([]);
    expect(cfg.providerOrder).toEqual(["codex"]);
    expect(JSON.parse(await readFile(globalConfigPath(), "utf8")).providerOrder).toEqual(["codex"]);
  });

  it("the provider order drives Automatic", async () => {
    const { world } = await setup();
    expect(await world.orchestrator.autoProvider()).toBe("claude");
    await world.setProviderOrder(["codex"]);
    expect(await world.orchestrator.autoProvider()).toBe("codex");
    const snap = await world.snapshot();
    expect(snap.autoProvider).toBe("codex");
    expect(snap.providers[0]!.provider).toBe("codex");
  });
});
