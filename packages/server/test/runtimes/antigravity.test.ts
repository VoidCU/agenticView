import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, access, readdir, utimes } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultAgent, type RunEvent, type ToolAllowance } from "@agenticview/shared";
import {
  AntigravityRuntime,
  buildAgyArgs,
  bridgeServerName,
  cleanupAntigravityPlugins,
  flushAgyText,
  deniedTools,
  denyHookCommand,
  installRunPlugin,
  killTree,
  mapAgyLine,
  newAgyMapState,
} from "../../src/runtimes/antigravity.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");
const fakeAgy = join(fixtures, "fake-agy.mjs");
const agent = defaultAgent({ name: "A", role: "worker", scope: "project", specialty: "", provider: "antigravity" });
const ALL: ToolAllowance = { edit: true, shell: true, web: true, screenshot: false };
let cwd: string;
let home: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "av-agy-"));
  home = await mkdtemp(join(tmpdir(), "av-agy-home-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function mapFixture(name: string) {
  const state = newAgyMapState();
  const events: RunEvent[] = [];
  let sessionId: string | undefined;
  let result: ReturnType<typeof mapAgyLine>["result"];
  for (const line of readFileSync(join(fixtures, name), "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const m = mapAgyLine(line, state);
    events.push(...m.events);
    if (m.sessionId) sessionId = m.sessionId;
    if (m.result) result = m.result;
  }
  events.push(...flushAgyText(state));
  return { events, sessionId, result };
}

describe("mapAgyLine (recorded agy 1.2.11 streams)", () => {
  it("maps file writes, edits, commands and the final answer", () => {
    const { events, sessionId, result } = mapFixture("agy-edit-run.ndjson");
    expect(sessionId).toBe("40ab02e6-dc30-4341-b686-f1be80a1a93b");
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end", "file_changed", "tool_start", "tool_end", "file_changed", "tool_start", "tool_end", "text"]);
    expect(events[0]).toMatchObject({ type: "tool_start", name: "write_to_file" });
    expect(events[2]).toMatchObject({ type: "file_changed", kind: "create" });
    expect((events[2] as { path: string }).path).toMatch(/hello\.txt$/);
    expect(events[5]).toMatchObject({ type: "file_changed", kind: "modify" });
    expect(events[6]).toMatchObject({ type: "tool_start", name: "run_command", input: { CommandLine: "dir" } });
    expect(events[7]).toMatchObject({ type: "tool_end", name: "run_command", ok: true });
    const text = events[8] as { text: string };
    expect(text.text).toMatch(/^All requested steps have been completed/);
    expect(result).toMatchObject({ ok: true, usage: { inputTokens: 65436, outputTokens: 1443 } });
  });

  it("names MCP calls after the bridge tool and passes its arguments", () => {
    const { events } = mapFixture("agy-mcp-call.ndjson");
    const start = events.find((e) => e.type === "tool_start" && e.name === "get_secret");
    expect(start).toEqual({ type: "tool_start", name: "get_secret", input: {} });
    expect(events.find((e) => e.type === "tool_end" && e.name === "get_secret")).toMatchObject({ ok: true, summary: "PINEAPPLE42" });
  });

  it("reports denied tools as failed tool calls and a status line", () => {
    const { events, result } = mapFixture("agy-plan-denied.ndjson");
    const end = events.find((e) => e.type === "tool_end" && e.name === "run_command") as { ok: boolean; summary: string };
    expect(end.ok).toBe(false);
    expect(end.summary).toMatch(/permission check failed/);
    expect(events).toContainEqual({ type: "status", text: "denied: RunCommand" });
    expect(result?.ok).toBe(true);
  });

  it("maps an error result and tolerates junk lines", () => {
    const state = newAgyMapState();
    expect(mapAgyLine("not json", state).events).toEqual([{ type: "status", text: "not json" }]);
    const r = mapAgyLine(JSON.stringify({ event: "result", result: { status: "ERROR", error: "invalid model selection" } }), state);
    expect(r.result).toMatchObject({ ok: false, error: "invalid model selection" });
  });
});

describe("buildAgyArgs", () => {
  const base = { prompt: "hi", permissionMode: "ask" as const, tools: ALL };
  it("builds a plain headless run", () => {
    expect(buildAgyArgs(base)).toEqual(["-p", "hi", "--output-format", "stream-json", "--disable-slash-commands"]);
  });
  it("adds model, supported effort and resume", () => {
    expect(buildAgyArgs({ ...base, model: "claude-sonnet-4-6", effort: "max", sessionId: "c1" })).toEqual([...buildAgyArgs(base), "--model", "claude-sonnet-4-6", "--effort", "max", "--conversation", "c1"]);
    expect(buildAgyArgs({ ...base, effort: "xhigh" })).not.toContain("--effort");
  });
  it("maps permission modes to agy's native modes without bridge tools", () => {
    expect(buildAgyArgs(base)).not.toContain("--mode");
    expect(buildAgyArgs({ ...base, permissionMode: "auto-edit" }).slice(-2)).toEqual(["--mode", "accept-edits"]);
    expect(buildAgyArgs({ ...base, permissionMode: "auto" }).slice(-1)).toEqual(["--dangerously-skip-permissions"]);
  });
  it("skips agy's permission checks when bridge tools must be callable", () => {
    for (const m of ["ask", "auto-edit", "auto"] as const) expect(buildAgyArgs({ ...base, permissionMode: m, bridge: true }).slice(-1)).toEqual(["--dangerously-skip-permissions"]);
  });
});

describe("deniedTools", () => {
  const has = (list: string[], names: string[]) => names.every((n) => list.includes(n));
  it("blocks edits and commands for ask (read-only, like Codex)", () => {
    const d = deniedTools("ask", ALL);
    expect(has(d, ["write_to_file", "replace_file_content", "run_command"])).toBe(true);
    expect(d).not.toContain("search_web");
  });
  it("blocks commands only for auto-edit, nothing for auto", () => {
    const d = deniedTools("auto-edit", ALL);
    expect(d).toContain("run_command");
    expect(d).not.toContain("write_to_file");
    expect(deniedTools("auto", ALL)).toEqual([]);
  });
  it("follows the agent's tool allowances", () => {
    const d = deniedTools("auto", { ...ALL, edit: false, shell: false, web: false });
    expect(has(d, ["write_to_file", "run_command", "search_web", "read_url_content", "open_browser_url"])).toBe(true);
  });
  it("builds quote-free deny hook commands on Windows", () => {
    expect(denyHookCommand("C:\\My Project\\.agents\\plugins\\agenticview-r_1", "win32")).toBe("cd /d C:\\My Project\\.agents\\plugins\\agenticview-r_1 && .\\deny.cmd");
    expect(denyHookCommand("/p", "linux")).toContain('"decision":"deny"');
  });
});

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_9",
  agent,
  cwd,
  prompt: [{ type: "text", text: "do it" }],
  systemPrompt: "You are A.",
  tools: agent.tools,
  bridgeTools: [],
  permissionMode: "auto-edit",
  bridgeToken: "t0k",
  ...over,
});

interface Seen {
  cmd?: string;
  args?: string[];
  plugins?: string[];
  config?: string;
  hooks?: string;
  files?: string[];
}

function fakeSpawn(mode = "ok", seen: Seen[] = []) {
  return ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const entry: Seen = { cmd, args };
    const dir = join(String(opts.cwd ?? cwd), ".agents", "plugins");
    if (existsSync(dir)) {
      entry.plugins = readdirSync(dir);
      const pdir = join(dir, entry.plugins[0]!);
      entry.files = readdirSync(pdir).sort();
      if (existsSync(join(pdir, "mcp_config.json"))) entry.config = readFileSync(join(pdir, "mcp_config.json"), "utf8");
      if (existsSync(join(pdir, "hooks.json"))) entry.hooks = readFileSync(join(pdir, "hooks.json"), "utf8");
    }
    seen.push(entry);
    return nodeSpawn(process.execPath, [fakeAgy, ...args], { ...opts, env: { ...(opts.env as Record<string, string>), FAKE_AGY_MODE: mode } });
  }) as never;
}

const rt = (spawn: never, extra: Partial<ConstructorParameters<typeof AntigravityRuntime>[0]> = {}) =>
  new AntigravityRuntime({ bridgeEntry: "C:/bridge/stdioBridge.js", bridgeUrl: () => "http://127.0.0.1:4242", spawn, which: async () => "C:/agy/agy.exe", home, ...extra });

describe("AntigravityRuntime.run", () => {
  it("streams a run and returns the conversation id as the session", async () => {
    const seen: { cmd?: string; args?: string[] }[] = [];
    const events: RunEvent[] = [];
    const res = await rt(fakeSpawn("ok", seen)).run(req({ model: "gemini-3.1-pro-high", sessionId: "prev" }), (e) => events.push(e), new AbortController().signal);
    expect(res.stopReason).toBe("done");
    expect(res.sessionId).toBe("40ab02e6-dc30-4341-b686-f1be80a1a93b");
    expect(res.text).toMatch(/All requested steps/);
    expect(res.usage).toEqual({ inputTokens: 65436, outputTokens: 1443 });
    expect(seen[0]!.cmd).toBe("C:/agy/agy.exe");
    const args = seen[0]!.args!;
    expect(args[1]).toMatch(/^You are A\.[\s\S]*do it$/);
    expect(args).toEqual(expect.arrayContaining(["--model", "gemini-3.1-pro-high", "--conversation", "prev", "--mode", "accept-edits"]));
    expect(events.filter((e) => e.type === "file_changed")).toHaveLength(2);
  });

  it("returns agy's error result", async () => {
    const res = await rt(fakeSpawn("error")).run(req(), () => {}, new AbortController().signal);
    expect(res).toMatchObject({ stopReason: "error", error: "invalid model selection" });
  });

  it("reports a crash with stderr", async () => {
    const res = await rt(fakeSpawn("crash")).run(req(), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("error");
    expect(res.error).toMatch(/exited with code 2[\s\S]*boom/);
  });

  it("aborts a hanging run", async () => {
    const ac = new AbortController();
    // Abort only after the run has demonstrably started (first event mapped), so the init line
    // carrying the conversation id has been parsed even on a slow, loaded machine.
    let sinkHook: (() => void) | undefined;
    const started = new Promise<void>((r) => {
      let done = false;
      sinkHook = () => {
        if (!done) {
          done = true;
          r();
        }
      };
    });
    const p = rt(fakeSpawn("hang"), { platform: "linux" }).run(req(), () => sinkHook?.(), ac.signal);
    await started;
    ac.abort();
    const res = await p;
    expect(res.stopReason).toBe("aborted");
    expect(res.sessionId).toBe("c-hang");
  }, 20000);

  it("installs the bridge and deny hooks as a workspace plugin only for the run", async () => {
    const seen: Seen[] = [];
    const tool = { name: "delegate", description: "", schema: {}, handler: async () => "ok" };
    await mkdir(join(home, ".gemini", "antigravity-cli", "mcp", bridgeServerName("r_B")), { recursive: true });
    const res = await rt(fakeSpawn("ok", seen), { platform: "win32" }).run(req({ runId: "r_B", bridgeTools: [tool], permissionMode: "ask" }), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("done");
    expect(seen[0]!.plugins).toEqual(["agenticview-r_B"]);
    expect(seen[0]!.files).toEqual(["deny.cmd", "hooks.json", "mcp_config.json", "plugin.json"]);
    const cfg = JSON.parse(seen[0]!.config!);
    expect(cfg.mcpServers.agenticview).toMatchObject({ command: process.execPath, args: ["C:/bridge/stdioBridge.js"], env: { AGENTICVIEW_BRIDGE_URL: "http://127.0.0.1:4242", AGENTICVIEW_RUN_ID: "r_B", AGENTICVIEW_BRIDGE_TOKEN: "t0k" } });
    const hooks = JSON.parse(seen[0]!.hooks!)["agenticview-guard"].PreToolUse as { matcher: string; hooks: { command: string }[] }[];
    expect(hooks.map((h) => h.matcher)).toEqual(expect.arrayContaining(["write_to_file", "run_command"]));
    expect(hooks[0]!.hooks[0]!.command).toMatch(/^cd \/d .*agenticview-r_B && \.\\deny\.cmd$/);
    const args = seen[0]!.args!;
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args[1]).toContain('MCP server "agenticview-r_B_agenticview"');
    expect(args[1]).toContain("You may not create, edit or delete files");
    await expect(access(join(cwd, ".agents"))).rejects.toThrow();
    await expect(access(join(home, ".gemini", "antigravity-cli", "mcp", bridgeServerName("r_B")))).rejects.toThrow();
  });

  it("writes no plugin when nothing needs blocking and there are no bridge tools", async () => {
    const seen: Seen[] = [];
    await rt(fakeSpawn("ok", seen)).run(req({ permissionMode: "auto", tools: ALL }), () => {}, new AbortController().signal);
    expect(seen[0]!.plugins).toBeUndefined();
    expect(seen[0]!.args).toContain("--dangerously-skip-permissions");
  });

  it("keeps a user's existing .agents/plugins folder", async () => {
    await mkdir(join(cwd, ".agents", "plugins", "mine"), { recursive: true });
    const restore = await installRunPlugin(cwd, "r_1", { server: { command: "node", args: [], env: {} }, deny: [] }, home);
    expect((await readdir(join(cwd, ".agents", "plugins"))).sort()).toEqual(["agenticview-r_1", "mine"]);
    await restore();
    expect(await readdir(join(cwd, ".agents", "plugins"))).toEqual(["mine"]);
  });

  it("tells the model which tools are blocked", async () => {
    const seen: Seen[] = [];
    await rt(fakeSpawn("ok", seen)).run(req({ tools: { ...ALL, web: false } }), () => {}, new AbortController().signal);
    expect(seen[0]!.args![1]).toContain("You may not search the web");
    expect(JSON.parse(seen[0]!.hooks!)["agenticview-guard"].PreToolUse.map((h: { matcher: string }) => h.matcher)).toContain("search_web");
  });
});

describe("cleanupAntigravityPlugins", () => {
  it("removes only marked AgenticView plugins and stale schema caches", async () => {
    const plugins = join(cwd, ".agents", "plugins");
    await mkdir(join(plugins, "agenticview-r_old"), { recursive: true });
    await writeFile(join(plugins, "agenticview-r_old", "plugin.json"), JSON.stringify({ name: "agenticview-r_old", "agenticview-managed": true }));
    await mkdir(join(plugins, "agenticview-custom"), { recursive: true });
    await writeFile(join(plugins, "agenticview-custom", "plugin.json"), JSON.stringify({ name: "agenticview-custom" }));
    const cache = join(home, ".gemini", "antigravity-cli", "mcp");
    await mkdir(join(cache, "agenticview-r_old_agenticview"), { recursive: true });
    await mkdir(join(cache, "agenticview-r_new_agenticview"), { recursive: true });
    await mkdir(join(cache, "other_server"), { recursive: true });
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await utimes(join(cache, "agenticview-r_old_agenticview"), old, old);
    await cleanupAntigravityPlugins(cwd, home);
    expect(await readdir(plugins)).toEqual(["agenticview-custom"]);
    expect((await readdir(cache)).sort()).toEqual(["agenticview-r_new_agenticview", "other_server"]);
    await expect(cleanupAntigravityPlugins(join(cwd, "nowhere"), join(home, "nowhere"))).resolves.toBeUndefined();
  });

  it("removes .agents/plugins and .agents themselves when they become empty after cleanup", async () => {
    const agentsDir = join(cwd, ".agents");
    const plugins = join(agentsDir, "plugins");
    // Only AgenticView-managed plugins — no user files anywhere under .agents.
    await mkdir(join(plugins, "agenticview-r_crash"), { recursive: true });
    await writeFile(join(plugins, "agenticview-r_crash", "plugin.json"), JSON.stringify({ name: "agenticview-r_crash", "agenticview-managed": true }));
    await writeFile(join(plugins, "agenticview-r_crash", "hooks.json"), JSON.stringify({}));
    await cleanupAntigravityPlugins(cwd, home);
    // Both the plugins dir and .agents dir should be gone (they were only AgenticView content).
    await expect(access(plugins)).rejects.toThrow();
    await expect(access(agentsDir)).rejects.toThrow();
  });

  it("leaves .agents in place when it contains user-owned files alongside managed plugins", async () => {
    const agentsDir = join(cwd, ".agents");
    const plugins = join(agentsDir, "plugins");
    await mkdir(join(plugins, "agenticview-r_stale"), { recursive: true });
    await writeFile(join(plugins, "agenticview-r_stale", "plugin.json"), JSON.stringify({ name: "agenticview-r_stale", "agenticview-managed": true }));
    // User has their own file directly under .agents.
    await writeFile(join(agentsDir, "user-config.json"), "{}");
    await cleanupAntigravityPlugins(cwd, home);
    // plugins dir is gone (empty after removing managed plugin), but .agents stays.
    await expect(access(plugins)).rejects.toThrow();
    expect((await readdir(agentsDir))).toContain("user-config.json");
  });
});

describe("AntigravityRuntime.check", () => {
  it("finds agy on PATH and reports its version", async () => {
    const spawn = ((_c: string, args: string[], opts: Record<string, unknown>) => nodeSpawn(process.execPath, [fakeAgy, ...args], opts)) as never;
    const s = await rt(spawn, { which: async () => "C:/tools/agy.exe" }).check();
    expect(s).toEqual({ provider: "antigravity", ok: true, version: "agy 1.2.11 (C:/tools/agy.exe)" });
  });

  it("falls back to %LOCALAPPDATA%\\agy\\bin\\agy.exe on Windows", async () => {
    await mkdir(join(home, "agy", "bin"), { recursive: true });
    await writeFile(join(home, "agy", "bin", "agy.exe"), "");
    const spawn = ((_c: string, args: string[], opts: Record<string, unknown>) => nodeSpawn(process.execPath, [fakeAgy, ...args], opts)) as never;
    const runtime = rt(spawn, { which: async () => undefined, platform: "win32", env: { LOCALAPPDATA: home } });
    expect(await runtime.locate()).toBe(join(home, "agy", "bin", "agy.exe"));
    expect((await runtime.check()).ok).toBe(true);
  });

  it("reports the install hint when agy is missing", async () => {
    const s = await rt(fakeSpawn(), { which: async () => undefined, platform: "linux", env: {} }).check();
    expect(s).toMatchObject({ provider: "antigravity", ok: false });
    expect(s.reason).toMatch(/Antigravity CLI/);
  });

  it("still reports ok with the path when --version fails", async () => {
    const spawn = (() => {
      throw new Error("ENOENT");
    }) as never;
    expect(await rt(spawn).check()).toEqual({ provider: "antigravity", ok: true, version: "C:/agy/agy.exe" });
  });
});

describe("killTree", () => {
  it("uses taskkill /T /F on Windows", () => {
    const calls: string[][] = [];
    const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null, kill: () => calls.push(["kill"]) });
    const spawn = ((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return new EventEmitter();
    }) as never;
    killTree(child as never, "win32", spawn);
    expect(calls).toEqual([["taskkill", "/pid", "42", "/T", "/F"]]);
    killTree(child as never, "linux", spawn);
    expect(calls[1]).toEqual(["kill"]);
  });
});

