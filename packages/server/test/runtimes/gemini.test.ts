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
  await rm(cwd, { recursive: true, force: true });
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
    expect(during.mcpServers.agenticview).toMatchObject({ command: process.execPath, args: ["C:/bridge/stdioBridge.js"], env: { AGENTICVIEW_BRIDGE_URL: "http://127.0.0.1:4242", AGENTICVIEW_RUN_ID: "r_9" }, trust: true });
    expect(during.mcpServers.agenticview.env.AGENTICVIEW_BRIDGE_TOKEN).toBe("t0k");
    expect(await readFile(join(cwd, ".gemini", "settings.json"), "utf8")).toBe(before);
    expect(seenArgv).toEqual(expect.arrayContaining(["--allowed-mcp-server-names", "agenticview", "--approval-mode", "auto_edit"]));
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
