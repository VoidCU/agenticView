import { describe, it, expect, afterEach } from "vitest";
import {
  AgentSchema,
  ClientMessageSchema,
  GlobalConfigSchema,
  ProviderSchema,
  catalogueFor,
  defaultAgent,
  effortsFor,
  findCustomProvider,
  isKnownProvider,
  orderedProviders,
  providerLabelOf,
  setCustomProviders,
  toCustomInfo,
} from "../src/index.js";

afterEach(() => setCustomProviders([]));

describe("custom provider config", () => {
  it("parses providers.custom and drops invalid or duplicate entries", () => {
    const cfg = GlobalConfigSchema.parse({
      providers: {
        custom: [
          { id: "local-llm", label: "Local LLM", engine: "openai", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "sk-x", models: [{ id: "qwen3" }], defaultModel: "qwen3" },
          { id: "Bad Id", label: "x", engine: "openai", baseUrl: "http://x" },
          { id: "local-llm", label: "dup", engine: "anthropic", baseUrl: "http://y" },
          { id: "proxy", label: "Proxy", engine: "anthropic", baseUrl: "not a url" },
        ],
      },
      providerOrder: ["codex", "custom:local-llm"],
    });
    expect(cfg.providers.custom).toHaveLength(1);
    expect(cfg.providers.custom[0]).toMatchObject({ id: "local-llm", engine: "openai", apiKey: "sk-x", defaultModel: "qwen3" });
    expect(cfg.providerOrder).toEqual(["codex", "custom:local-llm"]);
    // Older configs without the new fields still parse.
    const old = GlobalConfigSchema.parse({ providers: { claude: { apiKey: "k" } } });
    expect(old.providers.custom).toEqual([]);
    expect(old.providerOrder).toEqual([]);
  });

  it("wire info never carries the key", () => {
    const info = toCustomInfo({ id: "a", label: "A", engine: "openai", baseUrl: "http://a", apiKey: "secret", models: [], defaultModel: null });
    expect(info.hasKey).toBe(true);
    expect(JSON.stringify(info)).not.toContain("secret");
  });

  it("provider ids accept custom:<slug> everywhere a provider is accepted", () => {
    expect(ProviderSchema.safeParse("custom:local-llm").success).toBe(true);
    expect(ProviderSchema.safeParse("custom:Bad").success).toBe(false);
    expect(ProviderSchema.safeParse("openai").success).toBe(false);
    expect(AgentSchema.parse(defaultAgent({ name: "a", specialty: "", role: "worker", scope: "project", provider: "custom:x" })).provider).toBe("custom:x");
    const msg = ClientMessageSchema.safeParse({ type: "agent.switch", id: "a", provider: "custom:x", model: "m" });
    expect(msg.success).toBe(true);
  });

  it("key and custom provider messages validate", () => {
    expect(ClientMessageSchema.safeParse({ type: "provider.setKey", provider: "gemini", apiKey: "k" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "provider.setKey", provider: "copilot", apiKey: "k" }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "customProvider.upsert", provider: { id: "p", label: "P", engine: "anthropic", baseUrl: "https://p.example/v1" } }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "provider.order", order: ["codex", "custom:p"] }).success).toBe(true);
  });
});

describe("custom provider registry", () => {
  it("labels, catalogue and known-ness follow the registered list", () => {
    expect(isKnownProvider("custom:local")).toBe(false);
    setCustomProviders([{ id: "local", label: "Local", engine: "openai", baseUrl: "http://l/v1", models: [{ id: "m1", label: "Model one" }, { id: "m2" }], defaultModel: "m1", apiKey: "k" }]);
    expect(isKnownProvider("custom:local")).toBe(true);
    expect(findCustomProvider("custom:local")?.hasKey).toBe(true);
    expect(providerLabelOf("custom:local")).toBe("Local");
    expect(providerLabelOf("codex")).toBe("Codex");
    const cat = catalogueFor("custom:local");
    expect(cat.models.map((m) => [m.id, m.label])).toEqual([["m1", "Model one"], ["m2", "m2"]]);
    expect(cat.allowCustom).toBe(true);
    expect(effortsFor("custom:local", "m1")).toEqual([]);
  });

  it("orderedProviders applies the user order, drops unknown ids and appends new providers", () => {
    setCustomProviders([{ id: "z", label: "Z", engine: "openai", baseUrl: "http://z", models: [], defaultModel: null, hasKey: false }]);
    const out = orderedProviders(["custom:z", "gemini", "custom:gone", "gemini"]);
    expect(out.slice(0, 2)).toEqual(["custom:z", "gemini"]);
    expect(out).toContain("claude");
    expect(out).not.toContain("custom:gone");
    expect(new Set(out).size).toBe(out.length);
    expect(orderedProviders([])[0]).toBe("claude");
  });
});
