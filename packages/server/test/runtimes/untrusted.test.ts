import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultAgent, type Provider, type ToolAllowance } from "@agenticview/shared";
import { CopilotRuntime } from "../../src/runtimes/copilot.js";
import { GeminiRuntime } from "../../src/runtimes/gemini.js";
import { AntigravityRuntime } from "../../src/runtimes/antigravity.js";
import { UNTRUSTED_MCP_REFUSAL, hasUserMcpServers } from "../../src/runtimes/untrusted.js";
import { classifyError } from "../../src/runtimes/errors.js";
import type { Runtime, RunRequest } from "../../src/runtimes/types.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");
const OFF: ToolAllowance = { edit: false, shell: false, web: false, screenshot: false };

let cwd: string;
let home: string;
let tmp: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "av-untr-"));
  home = await mkdtemp(join(tmpdir(), "av-untr-home-"));
  tmp = await mkdtemp(join(tmpdir(), "av-untr-tmp-"));
});
afterEach(async () => {
  for (const d of [cwd, home, tmp]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const put = async (file: string, body: unknown) => {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, typeof body === "string" ? body : JSON.stringify(body), "utf8");
};

/** A spawn that records each call and runs the provider's fake CLI fixture. */
function spawnVia(fixture: string, modeVar: string, calls: string[][]) {
  return ((_cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push(args);
    return nodeSpawn(process.execPath, [join(fixtures, fixture), ...args], { ...opts, env: { ...(opts.env as Record<string, string>), [modeVar]: "ok" } } as never);
  }) as never;
}

const req = (provider: Provider, over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_u1",
  agent: defaultAgent({ name: "U", role: "worker", scope: "project", specialty: "", provider }),
  cwd,
  prompt: [{ type: "text", text: "reply to this email" }],
  systemPrompt: "You are U.",
  tools: OFF,
  bridgeTools: [],
  permissionMode: "auto",
  readOnly: true,
  untrusted: true,
  ...over,
});

const run = (rt: Runtime, r: RunRequest) => rt.run(r, () => {}, new AbortController().signal);

describe("hasUserMcpServers", () => {
  it("missing or empty is none; servers, junk JSON or a non-object mcpServers fail closed", async () => {
    const f = join(home, "c.json");
    expect(await hasUserMcpServers(f)).toBe(false);
    await put(f, { mcpServers: {} });
    expect(await hasUserMcpServers(f)).toBe(false);
    await put(f, { other: 1 });
    expect(await hasUserMcpServers(f)).toBe(false);
    await put(f, { mcpServers: { x: { command: "evil" } } });
    expect(await hasUserMcpServers(f)).toBe(true);
    expect(await hasUserMcpServers(f, (n) => n === "x")).toBe(false);
    await put(f, "{ not json");
    expect(await hasUserMcpServers(f)).toBe(true);
    await put(f, { mcpServers: ["x"] });
    expect(await hasUserMcpServers(f)).toBe(true);
  });

  it("the refusal is not a crash, so it never triggers a provider switch", () => {
    expect(classifyError(UNTRUSTED_MCP_REFUSAL)).not.toBe("crash");
    expect(classifyError(UNTRUSTED_MCP_REFUSAL)).not.toBe("quota");
    expect(classifyError(UNTRUSTED_MCP_REFUSAL)).not.toBe("rate-limit");
  });
});

describe("copilot untrusted runs", () => {
  const rt = (calls: string[][]) =>
    new CopilotRuntime({ bridgeEntry: "b", bridgeUrl: () => "u", spawn: spawnVia("fake-copilot.mjs", "FAKE_COPILOT_MODE", calls), which: async () => "C:/tools/copilot.exe", tmpDir: tmp, home });
  const cfg = () => join(home, ".copilot", "mcp-config.json");

  it("refuses when ~/.copilot/mcp-config.json has servers, or cannot be parsed", async () => {
    for (const body of [{ mcpServers: { gh: { command: "x" } } }, "{oops"]) {
      await put(cfg(), body);
      const calls: string[][] = [];
      const res = await run(rt(calls), req("copilot"));
      expect(res).toMatchObject({ stopReason: "error", error: UNTRUSTED_MCP_REFUSAL });
      expect(calls).toHaveLength(0);
    }
  });

  it("runs without user servers, and a readOnly run that is not untrusted is unchanged", async () => {
    const calls: string[][] = [];
    expect((await run(rt(calls), req("copilot"))).stopReason).toBe("done");
    await put(cfg(), { mcpServers: { gh: { command: "x" } } });
    expect((await run(rt(calls), req("copilot", { untrusted: undefined }))).stopReason).toBe("done");
    expect(calls).toHaveLength(2);
  });
});

describe("gemini untrusted runs", () => {
  const rt = (calls: string[][]) =>
    new GeminiRuntime({ bin: "gemini", bridgeEntry: "b", bridgeUrl: () => "u", spawn: spawnVia("fake-gemini.mjs", "FAKE_GEMINI_MODE", calls), which: async () => "gemini", home });

  it("refuses for servers in ~/.gemini/settings.json, the project's .gemini/settings.json or an extension", async () => {
    const places = [
      join(home, ".gemini", "settings.json"),
      join(cwd, ".gemini", "settings.json"),
      join(home, ".gemini", "extensions", "ext1", "gemini-extension.json"),
    ];
    for (const file of places) {
      await put(file, { mcpServers: { s: { command: "x" } } });
      const calls: string[][] = [];
      const res = await run(rt(calls), req("gemini"));
      expect(res).toMatchObject({ stopReason: "error", error: UNTRUSTED_MCP_REFUSAL });
      expect(calls).toHaveLength(0);
      await rm(file);
    }
    await put(join(home, ".gemini", "settings.json"), "{ // comment\n}");
    expect(await run(rt([]), req("gemini"))).toMatchObject({ error: UNTRUSTED_MCP_REFUSAL });
  });

  it("runs without user servers (settings without mcpServers are fine), and a non-untrusted readOnly run is unchanged", async () => {
    await put(join(home, ".gemini", "settings.json"), { theme: "dark" });
    const calls: string[][] = [];
    expect((await run(rt(calls), req("gemini"))).stopReason).toBe("done");
    await put(join(cwd, ".gemini", "settings.json"), { mcpServers: { s: { command: "x" } } });
    expect((await run(rt(calls), req("gemini", { untrusted: undefined }))).stopReason).toBe("done");
    expect(calls).toHaveLength(2);
  });
});

describe("antigravity untrusted runs", () => {
  const rt = (calls: string[][]) =>
    new AntigravityRuntime({ bridgeEntry: "b", bridgeUrl: () => "u", spawn: spawnVia("fake-agy.mjs", "FAKE_AGY_MODE", calls), which: async () => "C:/agy/agy.exe", home });

  it("refuses for servers in agy's global mcp_config.json or a workspace plugin", async () => {
    for (const file of [join(home, ".gemini", "config", "mcp_config.json"), join(cwd, ".agents", "plugins", "mine", "mcp_config.json")]) {
      await put(file, { mcpServers: { s: { command: "x" } } });
      const calls: string[][] = [];
      const res = await run(rt(calls), req("antigravity"));
      expect(res).toMatchObject({ stopReason: "error", error: UNTRUSTED_MCP_REFUSAL });
      expect(calls).toHaveLength(0);
      await rm(file);
    }
  });

  it("runs without user servers, and a non-untrusted readOnly run is unchanged", async () => {
    const calls: string[][] = [];
    expect((await run(rt(calls), req("antigravity"))).stopReason).toBe("done");
    await put(join(home, ".gemini", "config", "mcp_config.json"), { mcpServers: { s: { command: "x" } } });
    expect((await run(rt(calls), req("antigravity", { untrusted: undefined }))).stopReason).toBe("done");
    expect(calls).toHaveLength(2);
  });
});
