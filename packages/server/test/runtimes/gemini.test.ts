import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultAgent } from "@agenticview/shared";
import { GeminiRuntime } from "../../src/runtimes/gemini.js";
import type { RunRequest } from "../../src/runtimes/types.js";
import { z } from "zod";

const fixture = resolve(import.meta.dirname, "../fixtures/fake-gemini.mjs");
const agent = defaultAgent({ name: "G", role: "worker", scope: "project", specialty: "", provider: "gemini" });
let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "av-gem-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function rt(mode = "ok", extraEnv: Record<string, string> = {}) {
  const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) =>
    nodeSpawn(process.execPath, [fixture, ...args], { ...opts, env: { ...(opts.env as Record<string, string>), FAKE_GEMINI_MODE: mode, ...extraEnv } })) as never;
  return new GeminiRuntime({ bin: "gemini", bridgeEntry: "C:/bridge/stdioBridge.js", bridgeUrl: () => "http://127.0.0.1:4242", spawn, which: async () => "gemini" });
}

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_9",
  agent,
  cwd,
  prompt: [{ type: "text", text: "do it" }],
  systemPrompt: "You are G.",
  tools: agent.tools,
  bridgeTools: [],
  permissionMode: "auto-edit",
  bridgeToken: "t0k",
  ...over,
});

describe("GeminiRuntime", () => {
  it("streams mapped events, passes flags, and returns the session id", async () => {
    const events: string[] = [];
    const res = await rt().run(req({ model: "gemini-2.5-pro", sessionId: "prev", prompt: [{ type: "text", text: "do it" }, { type: "image", path: "C:/shots/a.png" }] }), (e) => events.push(e.type), new AbortController().signal);
    expect(events).toEqual(["text", "tool_start", "file_changed", "tool_end", "status", "text"]);
    expect(res).toMatchObject({ stopReason: "done", sessionId: "g1", text: "Hello world" });
  });

  it("wires the MCP bridge into .gemini/settings.json only for the run and restores the file", async () => {
    await mkdir(join(cwd, ".gemini"), { recursive: true });
    const before = JSON.stringify({ theme: "x", mcpServers: { other: { command: "keep" } } }, null, 2);
    await writeFile(join(cwd, ".gemini", "settings.json"), before);
    let seenArgv: string[] = [];
    let duringRun: string | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      seenArgv = args;
      duringRun = require("node:fs").readFileSync(join(cwd, ".gemini", "settings.json"), "utf8");
      return nodeSpawn(process.execPath, [fixture, ...args], opts as never);
    }) as never;
    const runtime = new GeminiRuntime({ bin: "gemini", bridgeEntry: "C:/bridge/stdioBridge.js", bridgeUrl: () => "http://127.0.0.1:4242", spawn, which: async () => "gemini" });
    const tools = [{ name: "add", description: "", schema: { a: z.number() }, handler: async () => "1" }];
    await runtime.run(req({ bridgeTools: tools, permissionMode: "ask" }), () => {}, new AbortController().signal);
    const during = JSON.parse(duringRun!);
    expect(during.theme).toBe("x");
    expect(during.mcpServers.other).toEqual({ command: "keep" });
    expect(during.mcpServers["agenticview-r_9"]).toMatchObject({ command: process.execPath, args: ["C:/bridge/stdioBridge.js"], env: { AGENTICVIEW_BRIDGE_URL: "http://127.0.0.1:4242", AGENTICVIEW_RUN_ID: "r_9" }, trust: true });
    expect(during.mcpServers["agenticview-r_9"].env.AGENTICVIEW_BRIDGE_TOKEN).toBe("t0k");
    expect(await readFile(join(cwd, ".gemini", "settings.json"), "utf8")).toBe(before);
    expect(seenArgv).toEqual(expect.arrayContaining(["--allowed-mcp-server-names", "agenticview-r_9", "--approval-mode", "default"]));
  });

  it("removes a settings file it created when none existed", async () => {
    const tools = [{ name: "add", description: "", schema: {}, handler: async () => "1" }];
    await rt().run(req({ bridgeTools: tools }), () => {}, new AbortController().signal);
    await expect(access(join(cwd, ".gemini", "settings.json"))).rejects.toThrow();
  });

  it("passes prompt, images, approval modes and env", async () => {
    let seen: { argv: string[]; cwd: string } | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      const child = nodeSpawn(process.execPath, [fixture, ...args], opts as never);
      child.stderr.once("data", (d) => { try { seen = JSON.parse(String(d).split("\n")[0]!); } catch { /* ignore */ } });
      return child;
    }) as never;
    const runtime = new GeminiRuntime({ bin: "gemini", bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini", apiKey: "gk" });
    await runtime.run(req({ permissionMode: "auto", prompt: [{ type: "text", text: "look" }, { type: "image", path: "C:/shots/a.png" }] }), () => {}, new AbortController().signal);
    expect(seen!.argv).toEqual(expect.arrayContaining(["--approval-mode", "yolo", "--output-format", "stream-json"]));
    const p = seen!.argv[seen!.argv.indexOf("-p") + 1]!;
    expect(p).toContain("You are G.");
    expect(p).toContain("look");
    expect(p).toContain("@C:/shots/a.png");
    expect(seen!.argv).not.toContain("--allowed-mcp-server-names");
    expect(seen!.cwd.toLowerCase()).toBe(cwd.toLowerCase());
  });

  it("reports a non-zero exit with stderr and maps exit 53 to max_turns", async () => {
    const res = await rt("fail").run(req(), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("error");
    expect(res.error).toContain("boom");
    const mt = await rt("maxturns").run(req(), () => {}, new AbortController().signal);
    expect(mt.stopReason).toBe("max_turns");
  });

  it("aborts a hung process", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const res = await rt("hang").run(req(), () => {}, ac.signal);
    expect(res.stopReason).toBe("aborted");
  });

  it("check reports the install reason when the binary is missing", async () => {
    const missing = new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", which: async () => undefined });
    const s = await missing.check();
    expect(s).toMatchObject({ provider: "gemini", ok: false });
    expect(s.reason).toMatch(/Gemini CLI/);
    expect((await rt().check()).ok).toBe(true);
  });
});

describe("GeminiRuntime on Windows-style installs", () => {
  it("spawns node directly on the shim's target script when the binary is an npm .cmd shim", async () => {
    const shimDir = join(cwd, "npm");
    const entry = join(shimDir, "node_modules", "@google", "gemini-cli", "dist", "index.js");
    await mkdir(join(shimDir, "node_modules", "@google", "gemini-cli", "dist"), { recursive: true });
    await writeFile(entry, "");
    const shimBody = [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\node.exe"  "%dp0%\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*',
      "",
    ].join("\r\n");
    await writeFile(join(shimDir, "gemini.cmd"), shimBody);
    const calls: { cmd: string; args: string[] }[] = [];
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return nodeSpawn(process.execPath, [fixture, ...args.slice(1)], opts as never);
    }) as never;
    const runtime = new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => join(shimDir, "gemini.cmd") });
    const res = await runtime.run(req(), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("done");
    expect(calls[0]!.cmd).toBe(process.execPath);
    expect(calls[0]!.args[0]).toBe(entry);
    expect(calls[0]!.args).toContain("-p");
  });

  it("sends very long prompts on stdin instead of the command line", async () => {
    let seen: { argv: string[]; stdinLength?: number } | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      const child = nodeSpawn(process.execPath, [fixture, ...args], { ...opts, env: { ...(opts.env as Record<string, string>), FAKE_GEMINI_MODE: "stdin" } } as never);
      let buf = "";
      child.stderr.on("data", (d) => { buf += String(d); const line = buf.split("\n").find((l) => l.includes("stdinLength")); if (line) { try { seen = JSON.parse(line); } catch { /* wait */ } } });
      return child;
    }) as never;
    const runtime = new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini" });
    const big = "x".repeat(40_000);
    const res = await runtime.run(req({ prompt: [{ type: "text", text: big }] }), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("done");
    expect(seen!.stdinLength).toBeGreaterThanOrEqual(40_000);
    const p = seen!.argv[seen!.argv.indexOf("-p") + 1]!;
    expect(p.length).toBeLessThan(200);
  });
});

describe("GeminiRuntime tool allowance and concurrency", () => {
  const readSettings = () => require("node:fs").readFileSync(join(cwd, ".gemini", "settings.json"), "utf8");
  it("excludes tools the agent may not use via settings, even without bridge tools", async () => {
    let during: string | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      during = readSettings();
      return nodeSpawn(process.execPath, [fixture, ...args], opts as never);
    }) as never;
    const runtime = new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini" });
    const manager = { ...agent, tools: { edit: false, shell: false, web: false, screenshot: false } };
    await runtime.run(req({ agent: manager, tools: manager.tools, permissionMode: "auto" }), () => {}, new AbortController().signal);
    const s = JSON.parse(during!);
    expect(s.tools.exclude).toEqual(expect.arrayContaining(["write_file", "replace", "run_shell_command", "google_web_search", "web_fetch"]));
    expect(s.excludeTools).toEqual(s.tools.exclude);
    await expect(access(join(cwd, ".gemini", "settings.json"))).rejects.toThrow();
  });

  it("maps ask to the CLI's default approval mode", async () => {
    let seen: { argv: string[] } | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      seen = { argv: args };
      return nodeSpawn(process.execPath, [fixture, ...args], opts as never);
    }) as never;
    await new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini" }).run(req({ permissionMode: "ask" }), () => {}, new AbortController().signal);
    expect(seen!.argv[seen!.argv.indexOf("--approval-mode") + 1]).toBe("default");
  });

  it("two concurrent runs in one project each get their own entry and the file is restored once both finish", async () => {
    await mkdir(join(cwd, ".gemini"), { recursive: true });
    const before = JSON.stringify({ theme: "x" }, null, 2);
    await writeFile(join(cwd, ".gemini", "settings.json"), before);
    const snapshots: string[] = [];
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      snapshots.push(readSettings());
      return nodeSpawn(process.execPath, [fixture, ...args], { ...opts, env: { ...(opts.env as Record<string, string>), FAKE_GEMINI_MODE: "hang" } } as never);
    }) as never;
    const runtime = new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini" });
    const tools = [{ name: "add", description: "", schema: {}, handler: async () => "1" }];
    const acA = new AbortController();
    const acB = new AbortController();
    const a = runtime.run(req({ runId: "r_A", bridgeTools: tools, bridgeToken: "tA" }), () => {}, acA.signal);
    await new Promise((r) => setTimeout(r, 150));
    const b = runtime.run(req({ runId: "r_B", bridgeTools: tools, bridgeToken: "tB" }), () => {}, acB.signal);
    await new Promise((r) => setTimeout(r, 150));
    const duringBoth = JSON.parse(readSettings());
    expect(Object.keys(duringBoth.mcpServers).sort()).toEqual(["agenticview-r_A", "agenticview-r_B"]);
    expect(duringBoth.mcpServers["agenticview-r_B"].env.AGENTICVIEW_BRIDGE_TOKEN).toBe("tB");
    const argvB = snapshots.length;
    expect(argvB).toBe(2);
    acA.abort();
    await a;
    const afterA = JSON.parse(readSettings());
    expect(Object.keys(afterA.mcpServers)).toEqual(["agenticview-r_B"]);
    expect(afterA.theme).toBe("x");
    acB.abort();
    await b;
    expect(readSettings()).toBe(before);
  });

  it("names the allowed MCP server after the run", async () => {
    let seen: { argv: string[] } | undefined;
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      seen = { argv: args };
      return nodeSpawn(process.execPath, [fixture, ...args], opts as never);
    }) as never;
    await new GeminiRuntime({ bridgeEntry: "x", bridgeUrl: () => "u", spawn, which: async () => "gemini" }).run(req({ runId: "r_Z", bridgeTools: [{ name: "add", description: "", schema: {}, handler: async () => "1" }] }), () => {}, new AbortController().signal);
    expect(seen!.argv[seen!.argv.indexOf("--allowed-mcp-server-names") + 1]).toBe("agenticview-r_Z");
  });
});

describe("cleanupGeminiSettings", () => {
  it("strips stale agenticview entries on boot and deletes a file that only held them", async () => {
    const { cleanupGeminiSettings } = await import("../../src/runtimes/gemini.js");
    await mkdir(join(cwd, ".gemini"), { recursive: true });
    const file = join(cwd, ".gemini", "settings.json");
    await writeFile(file, JSON.stringify({ theme: "x", mcpServers: { keep: { command: "k" }, "agenticview-r_old": { command: "dead" } } }));
    await cleanupGeminiSettings(cwd);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ theme: "x", mcpServers: { keep: { command: "k" } } });
    await writeFile(file, JSON.stringify({ mcpServers: { "agenticview-r_old": { command: "dead" } }, tools: { exclude: ["write_file"] }, excludeTools: ["write_file"], agenticview: { managedExcludes: true } }));
    await cleanupGeminiSettings(cwd);
    await expect(access(file)).rejects.toThrow();
    await expect(cleanupGeminiSettings(join(cwd, "nowhere"))).resolves.toBeUndefined();
  });

  it("passes the model with -m and sends no effort flag (the CLI has none)", async () => {
    let seenArgv: string[] = [];
    const spawn: typeof nodeSpawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      seenArgv = args;
      return nodeSpawn(process.execPath, [fixture, ...args], opts as never);
    }) as never;
    const runtime = new GeminiRuntime({ bin: "gemini", bridgeEntry: "C:/bridge/stdioBridge.js", bridgeUrl: () => "http://127.0.0.1:4242", spawn, which: async () => "gemini" });
    await runtime.run(req({ model: "flash", effort: "high" }), () => {}, new AbortController().signal);
    expect(seenArgv).toEqual(expect.arrayContaining(["-m", "flash"]));
    expect(seenArgv.join(" ")).not.toMatch(/effort|thinking|high/);
  });
});
