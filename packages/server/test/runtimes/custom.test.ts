import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgent, getCustomProviders, setCustomProviders, type Provider } from "@agenticview/shared";
import { CodexRuntime, CUSTOM_KEY_ENV, codexEnvAndConfig, codexProviderId } from "../../src/runtimes/codex.js";
import { ClaudeRuntime, claudeChildEnv, type ClaudeSdk } from "../../src/runtimes/claude.js";
import { applyProviderConfig, createRuntimes } from "../../src/runtimes/index.js";
import { which } from "../../src/runtimes/which.js";
import { writeJsonFile } from "../../src/store/jsonStore.js";
import { globalConfigPath } from "../../src/world.js";
import type { RunRequest } from "../../src/runtimes/types.js";
import type { RunEvent } from "@agenticview/shared";
// @ts-expect-error plain .mjs test fixture
import { startFakeOpenAI } from "../fixtures/fake-openai.mjs";

const endpoint = { provider: "custom:local-llm" as Provider, name: "Local LLM", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-custom", defaultModel: "qwen3" };

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_1",
  agent: defaultAgent({ name: "C", role: "worker", scope: "project", specialty: "", provider: "custom:local-llm" }),
  cwd: tmpdir(),
  prompt: [{ type: "text", text: "say pong" }],
  systemPrompt: "",
  tools: { edit: false, shell: false, web: false, screenshot: false },
  bridgeTools: [],
  permissionMode: "ask",
  ...over,
});

describe("openai engine: codex overlay", () => {
  it("defines a model_providers entry, selects it, and puts the key only in the child env", () => {
    const before = process.env[CUSTOM_KEY_ENV];
    const { env, config } = codexEnvAndConfig({ PATH: "/bin", CODEX_API_KEY: "real-openai" }, { apiKey: "stored-codex", custom: endpoint });
    const id = codexProviderId("custom:local-llm");
    expect(id).toBe("agenticview_local_llm");
    expect(config.model_provider).toBe(id);
    expect(config.model_providers).toEqual({ [id]: { name: "Local LLM", base_url: "http://127.0.0.1:9/v1", wire_api: "responses", env_key: CUSTOM_KEY_ENV } });
    expect(env[CUSTOM_KEY_ENV]).toBe("sk-custom");
    expect(env.CODEX_API_KEY).toBe("real-openai"); // untouched: the custom provider does not use it
    expect(process.env[CUSTOM_KEY_ENV]).toBe(before);
  });

  it("omits env_key for a keyless endpoint and clears a stray key var", () => {
    const { env, config } = codexEnvAndConfig({ [CUSTOM_KEY_ENV]: "leak" }, { custom: { ...endpoint, apiKey: undefined } });
    const entry = (config.model_providers as Record<string, Record<string, unknown>>)[codexProviderId(endpoint.provider)]!;
    expect(entry.env_key).toBeUndefined();
    expect(env[CUSTOM_KEY_ENV]).toBeUndefined();
  });

  it("built-in codex: stored key goes to CODEX_API_KEY unless the environment already has one", () => {
    expect(codexEnvAndConfig({}, { apiKey: "k" }).env.CODEX_API_KEY).toBe("k");
    expect(codexEnvAndConfig({ CODEX_API_KEY: "env" }, { apiKey: "k" }).env.CODEX_API_KEY).toBe("env");
    expect(codexEnvAndConfig({}, { apiKey: "k" }).config.model_provider).toBeUndefined();
  });

  it("reports itself under the custom id", async () => {
    const rt = new CodexRuntime({ bridgeEntry: "x", bridgeUrl: () => "", which: async () => "C:/bin/codex", custom: endpoint });
    expect(rt.provider).toBe("custom:local-llm");
    const s = await rt.check();
    expect(s).toMatchObject({ provider: "custom:local-llm", ok: true });
    const missing = await new CodexRuntime({ bridgeEntry: "x", bridgeUrl: () => "", which: async () => undefined, custom: endpoint }).check();
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("Codex CLI");
  });
});

// One real round trip: the Codex CLI talks to a local fake Responses endpoint. Needs `codex` on PATH.
const codexBin = await which("codex");
describe.skipIf(!codexBin)("openai engine: live round trip through the codex CLI (fake endpoint)", () => {
  let srv: { url: string; requests: Array<{ path: string; auth?: string; model?: string }>; close: () => Promise<void> };
  beforeEach(async () => {
    srv = await startFakeOpenAI({ reply: "PONG from fake endpoint" });
  });
  afterEach(async () => {
    await srv.close();
  });

  it("runs a turn against the custom base URL with the custom key and model", async () => {
    const rt = new CodexRuntime({ bridgeEntry: "x", bridgeUrl: () => "", custom: { ...endpoint, baseUrl: srv.url } });
    const events: RunEvent[] = [];
    const res = await rt.run(req(), (e) => events.push(e), new AbortController().signal);
    expect(res.error).toBeUndefined();
    expect(res.stopReason).toBe("done");
    expect(res.text).toContain("PONG from fake endpoint");
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(srv.requests[0]).toMatchObject({ path: "/v1/responses", auth: "Bearer sk-custom", model: "qwen3" });
    expect(events.some((e) => e.type === "status" && /Model metadata/.test(e.text))).toBe(false);
    expect(process.env[CUSTOM_KEY_ENV]).toBeUndefined();
  }, 90_000);

  it("surfaces a 429 from the endpoint as an error the limit classifier recognises", async () => {
    await srv.close();
    srv = await startFakeOpenAI({ status: 429 });
    const rt = new CodexRuntime({ bridgeEntry: "x", bridgeUrl: () => "", custom: { ...endpoint, baseUrl: srv.url } });
    const res = await rt.run(req({ model: "other-model" }), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("error");
    expect(srv.requests[0]?.model).toBe("other-model");
    const { classifyError } = await import("../../src/runtimes/errors.js");
    expect(["rate-limit", "quota"]).toContain(classifyError(res.error ?? ""));
  }, 120_000);
});

describe("anthropic engine: agent SDK with base URL", () => {
  it("child env gets ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY and no routing env; ours is untouched", () => {
    const base = { PATH: "/bin", ANTHROPIC_API_KEY: "real", ANTHROPIC_AUTH_TOKEN: "tok", CLAUDE_CODE_USE_BEDROCK: "1" };
    const env = claudeChildEnv(base, { custom: { baseUrl: "https://proxy.example/anthropic", apiKey: "sk-proxy" } })!;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example/anthropic");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-proxy");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(base.ANTHROPIC_API_KEY).toBe("real");
    expect(claudeChildEnv({}, {})).toBeUndefined();
    expect(claudeChildEnv({ ANTHROPIC_API_KEY: "env" }, { apiKey: "k" })).toBeUndefined();
    expect(claudeChildEnv({}, { apiKey: "k" })?.ANTHROPIC_API_KEY).toBe("k");
  });

  it("runs with the chosen model (or the default) and the custom env", async () => {
    const seen: Record<string, unknown>[] = [];
    const sdk = {
      query: (({ options }: { options: Record<string, unknown> }) => {
        seen.push(options);
        return (async function* () {
          yield { type: "result", subtype: "success", result: "ok", session_id: "s", usage: { input_tokens: 1, output_tokens: 2 } };
        })();
      }) as never,
      tool: (() => ({})) as never,
      createSdkMcpServer: (() => ({})) as never,
    } as ClaudeSdk;
    const custom = { provider: "custom:proxy" as Provider, name: "Proxy", baseUrl: "https://proxy.example", apiKey: "sk-proxy", defaultModel: "glm-5" };
    const rt = new ClaudeRuntime({ sdk, custom });
    expect(rt.provider).toBe("custom:proxy");
    expect((await rt.check()).ok).toBe(true);
    await rt.run(req(), () => {}, new AbortController().signal);
    await rt.run(req({ model: "kimi-k3" }), () => {}, new AbortController().signal);
    expect(seen[0]!.model).toBe("glm-5");
    expect(seen[1]!.model).toBe("kimi-k3");
    const env = seen[0]!.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.example");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-proxy");
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    const keyless = await new ClaudeRuntime({ sdk, custom: { ...custom, apiKey: undefined } }).check();
    expect(keyless.ok).toBe(false);
  });
});

describe("registration", () => {
  let home: string;
  const savedHome = process.env.AGENTICVIEW_HOME;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "av-custom-"));
    process.env.AGENTICVIEW_HOME = home;
  });
  afterEach(async () => {
    process.env.AGENTICVIEW_HOME = savedHome;
    setCustomProviders([]);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("creates a runtime per custom entry on the right engine and hot-reloads on config change", async () => {
    await writeJsonFile(globalConfigPath(), {
      providers: {
        custom: [
          { id: "oa", label: "OA", engine: "openai", baseUrl: "http://127.0.0.1:1/v1", apiKey: "k1", models: [{ id: "m" }] },
          { id: "an", label: "AN", engine: "anthropic", baseUrl: "http://127.0.0.1:2", apiKey: "k2" },
        ],
      },
    });
    const map = await createRuntimes({ bridgeUrl: () => "http://127.0.0.1:1", which: async () => "C:/bin/codex" });
    expect(map.has("custom:oa")).toBe(true);
    expect(map.has("custom:an")).toBe(true);
    expect((await map.get("custom:oa")!.check()).version).toContain("codex via");
    expect((await map.get("custom:an")!.check()).version).toContain("agent-sdk via");
    expect(getCustomProviders().map((c) => c.id)).toEqual(["oa", "an"]);
    expect(JSON.stringify(getCustomProviders())).not.toContain("k1");

    const { GlobalConfigSchema } = await import("@agenticview/shared");
    applyProviderConfig(map, GlobalConfigSchema.parse({ providers: { custom: [{ id: "new", label: "New", engine: "openai", baseUrl: "http://x/v1" }] } }));
    expect(map.has("custom:oa")).toBe(false);
    expect(map.has("custom:new")).toBe(true);
    expect(map.has("copilot")).toBe(true);
  });
});
