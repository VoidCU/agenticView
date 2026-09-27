import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readdir, utimes } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultAgent, type RunEvent, type ToolAllowance } from "@agenticview/shared";
import {
  CopilotRuntime,
  SessionUsage,
  buildCopilotArgs,
  cleanupCopilotTemp,
  denyRules,
  mapCopilotLine,
  newCopilotMapState,
  patchFiles,
  usageTotals,
} from "../../src/runtimes/copilot.js";
import { classifyError, extractCliError } from "../../src/runtimes/errors.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");
const fakeCopilot = join(fixtures, "fake-copilot.mjs");
const agent = defaultAgent({ name: "P", role: "worker", scope: "project", specialty: "", provider: "copilot" });
const ALL: ToolAllowance = { edit: true, shell: true, web: true, screenshot: false };
let cwd: string;
let tmp: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "av-cop-"));
  tmp = await mkdtemp(join(tmpdir(), "av-cop-tmp-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function mapFixture(name: string, dir = "C:/work/cp/a") {
  const state = newCopilotMapState(dir);
  const events: RunEvent[] = [];
  let sessionId: string | undefined;
  let result: ReturnType<typeof mapCopilotLine>["result"];
  for (const line of readFileSync(join(fixtures, name), "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const m = mapCopilotLine(line, state);
    events.push(...m.events);
    if (m.sessionId) sessionId = m.sessionId;
    if (m.result) result = m.result;
  }
  return { events, sessionId, result };
}

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_1",
  agent,
  cwd,
  prompt: [{ type: "text", text: "do it" }],
  systemPrompt: "You are P.",
  tools: ALL,
  bridgeTools: [],
  permissionMode: "auto",
  bridgeToken: "t0k",
  ...over,
});

interface Seen {
  cmd: string;
  args: string[];
  stderr?: { argv: string[]; mcp?: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string>; tools: string[]; type: string }> } };
}

function fakeSpawn(mode = "ok", seen: Seen[] = [], env: Record<string, string> = {}) {
  return ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const s: Seen = { cmd, args };
    seen.push(s);
    const child = nodeSpawn(process.execPath, [fakeCopilot, ...args], { ...opts, env: { ...(opts.env as Record<string, string>), FAKE_COPILOT_MODE: mode, ...env } } as never);
    child.stderr!.once("data", (d) => {
      try {
        s.stderr = JSON.parse(String(d).split("\n")[0]!);
      } catch {
        /* not the argv line */
      }
    });
    return child;
  }) as never;
}

function rt(spawn: never, over: Partial<ConstructorParameters<typeof CopilotRuntime>[0]> = {}) {
  return new CopilotRuntime({ bridgeEntry: "C:/bridge/stdioBridge.js", bridgeUrl: () => "http://127.0.0.1:4242", spawn, which: async () => "C:/tools/copilot.exe", tmpDir: tmp, ...over });
}

describe("mapCopilotLine (recorded copilot 1.0.88 streams)", () => {
  it("maps patches, commands, the chosen model and the final answer", () => {
    const { events, sessionId, result } = mapFixture("copilot-edit-shell.ndjson");
    expect(sessionId).toBe("f8a50220-9950-4edf-84ef-63803bc2a49d");
    expect(result).toEqual({ exitCode: 0 });
    expect(events.map((e) => e.type)).toEqual(["status", "tool_start", "tool_end", "file_changed", "tool_start", "tool_end", "file_changed", "tool_start", "tool_end", "text"]);
    expect(events[0]).toEqual({ type: "status", text: "model: auto -> gpt-5.6-luna" });
    expect(events[1]).toMatchObject({ type: "tool_start", name: "apply_patch", input: { input: expect.stringContaining("*** Add File: hello.txt") } });
    expect(events[3]).toEqual({ type: "file_changed", path: resolve("C:/work/cp/a", "hello.txt"), kind: "create" });
    expect(events[6]).toEqual({ type: "file_changed", path: resolve("C:/work/cp/a", "hello.txt"), kind: "modify" });
    expect(events[7]).toMatchObject({ type: "tool_start", name: "powershell", input: { command: "echo done" } });
    expect(events[8]).toMatchObject({ type: "tool_end", name: "powershell", ok: true, summary: expect.stringContaining("done") });
    expect(events[9]).toEqual({ type: "text", text: "done" });
  });

  it("names MCP calls after the bridge tool and reports denied tools", () => {
    const { events } = mapFixture("copilot-mcp-readonly.ndjson");
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ name: "list_agents", input: {} });
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ name: "list_agents", ok: true, summary: "Atlas (manager), Pixel (worker)" });
    const failed = events.filter((e) => e.type === "tool_end" && !e.ok);
    expect(failed).toEqual([
      { type: "tool_end", name: "apply_patch", ok: false, summary: expect.stringContaining("`write`") },
      { type: "tool_end", name: "powershell", ok: false, summary: expect.stringContaining("`shell`") },
    ]);
    expect(events.some((e) => e.type === "file_changed")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "status", text: "denied: apply_patch, powershell" });
  });

  it("keeps edits but denies shell under the auto-edit rules", () => {
    const { events } = mapFixture("copilot-auto-edit-denied.ndjson", "C:/work/cp/d2");
    expect(events.filter((e) => e.type === "file_changed")).toEqual([{ type: "file_changed", path: resolve("C:/work/cp/d2", "x.txt"), kind: "create" }]);
    expect(events.at(-1)).toEqual({ type: "status", text: "denied: powershell" });
  });

  it("maps a plain answer and a resumed session", () => {
    const plain = mapFixture("copilot-plain.ndjson");
    const resumed = mapFixture("copilot-resume.ndjson");
    expect(plain.events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "4" }]);
    expect(resumed.events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "7" }]);
    expect(resumed.sessionId).toBe(plain.sessionId);
  });

  it("announces an explicit model once and tolerates junk and error lines", () => {
    const state = newCopilotMapState();
    const msg = JSON.stringify({ type: "assistant.message", data: { model: "claude-sonnet-5", content: "hi" } });
    expect(mapCopilotLine(msg, state).events).toEqual([{ type: "status", text: "model: claude-sonnet-5" }, { type: "text", text: "hi" }]);
    expect(mapCopilotLine(msg, state).events).toEqual([{ type: "text", text: "hi" }]);
    expect(mapCopilotLine("not json", state).events).toEqual([{ type: "status", text: "not json" }]);
    expect(mapCopilotLine(JSON.stringify({ type: "session.error", data: { message: "429 Too Many Requests" } }), state).events).toEqual([{ type: "status", text: "error: 429 Too Many Requests" }]);
    expect(mapCopilotLine("", state).events).toEqual([]);
  });
});

describe("patchFiles", () => {
  it("reads add, update, delete and move headers", () => {
    const patch = "*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: src/b.ts\n*** Move to: src/c.ts\n@@\n-a\n+b\n*** Delete File: d.txt\n*** End Patch\n";
    expect(patchFiles(patch)).toEqual([
      { path: "a.txt", kind: "create" },
      { path: "src/b.ts", kind: "modify" },
      { path: "src/c.ts", kind: "create" },
      { path: "d.txt", kind: "delete" },
    ]);
  });
});

describe("buildCopilotArgs", () => {
  const base = { prompt: "go", tools: ALL };
  it("runs headless with all tools allowed and nothing denied in auto", () => {
    expect(buildCopilotArgs({ ...base, permissionMode: "auto" })).toEqual(["-p", "go", "--output-format", "json", "--no-ask-user", "--allow-all-tools"]);
  });

  it("maps auto-edit to deny shell and ask to deny write + shell, without the GitHub MCP server", () => {
    const edit = buildCopilotArgs({ ...base, permissionMode: "auto-edit" });
    expect(edit).toEqual(expect.arrayContaining(["--allow-all-tools", "--deny-tool", "shell", "--disable-builtin-mcps"]));
    expect(edit).not.toContain("write");
    const ask = buildCopilotArgs({ ...base, permissionMode: "ask" });
    expect(ask.join(" ")).toContain("--deny-tool write --deny-tool shell");
    expect(denyRules("auto", { ...ALL, web: false, shell: false })).toEqual(["shell", "url"]);
    expect(denyRules("auto", { ...ALL, edit: false })).toEqual(["write"]);
  });

  it("adds model, effort, resume, MCP config, usage file and attachments", () => {
    const args = buildCopilotArgs({ ...base, permissionMode: "auto", model: "gpt-5.6-sol", effort: "xhigh", sessionId: "s1", mcpConfig: "C:/t/mcp.json", usageFile: "C:/t/u.json", attachments: ["C:/shots/a.png"] });
    expect(args.join(" ")).toContain("--model gpt-5.6-sol --reasoning-effort xhigh --resume s1 --additional-mcp-config @C:/t/mcp.json --usage-output-file C:/t/u.json --attachment C:/shots/a.png");
  });

  it("never sends an effort for auto or the default model (Copilot rejects it)", () => {
    expect(buildCopilotArgs({ ...base, permissionMode: "auto", model: "auto", effort: "high" })).not.toContain("--reasoning-effort");
    expect(buildCopilotArgs({ ...base, permissionMode: "auto", effort: "high" })).not.toContain("--reasoning-effort");
  });
});

describe("usage", () => {
  it("sums the usage report's per-model tokens", () => {
    expect(usageTotals(JSON.parse(readFileSync(join(fixtures, "copilot-usage.json"), "utf8")))).toEqual({ inputTokens: 14119, outputTokens: 5 });
    expect(usageTotals({})).toBeUndefined();
  });

  it("reports per-run deltas of the cumulative session totals", () => {
    const u = new SessionUsage();
    expect(u.delta("s", false, { inputTokens: 100, outputTokens: 5 })).toEqual({ inputTokens: 100, outputTokens: 5 });
    expect(u.delta("s", true, { inputTokens: 250, outputTokens: 9 })).toEqual({ inputTokens: 150, outputTokens: 4 });
    // Resumed session with an unknown baseline (e.g. after a restart): no usage rather than double counting.
    expect(u.delta("other", true, { inputTokens: 999, outputTokens: 1 })).toBeUndefined();
    expect(u.delta("other", true, { inputTokens: 1099, outputTokens: 3 })).toEqual({ inputTokens: 100, outputTokens: 2 });
  });
});

describe("CopilotRuntime.run", () => {
  it("streams a run, returns the session id and usage, and cleans its temp dir", async () => {
    const seen: Seen[] = [];
    const events: RunEvent[] = [];
    const res = await rt(fakeSpawn("ok", seen)).run(req({ model: "gpt-5.6-sol", effort: "high", prompt: [{ type: "text", text: "do it" }, { type: "image", path: "C:/shots/a.png" }] }), (e) => events.push(e), new AbortController().signal);
    expect(res).toMatchObject({ stopReason: "done", sessionId: "f8a50220-9950-4edf-84ef-63803bc2a49d", text: "done", usage: { inputTokens: 14119, outputTokens: 5 } });
    expect(seen[0]!.cmd).toBe("C:/tools/copilot.exe");
    const args = seen[0]!.args;
    expect(args[1]).toMatch(/^You are P\.[\s\S]*do it$/);
    expect(args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-sol", "--reasoning-effort", "high", "--attachment", "C:/shots/a.png", "--allow-all-tools"]));
    expect(args).not.toContain("--additional-mcp-config");
    expect(events.filter((e) => e.type === "file_changed")).toHaveLength(2);
    expect(await readdir(tmp)).toEqual([]);
  });

  it("gives bridge tools a per-run MCP server and removes it afterwards", async () => {
    const seen: Seen[] = [];
    const tool = { name: "list_agents", description: "", schema: {}, handler: async () => "ok" };
    await rt(fakeSpawn("ok", seen, { FAKE_COPILOT_FIXTURE: "copilot-mcp-readonly.ndjson" })).run(req({ runId: "r_B", bridgeTools: [tool], permissionMode: "ask", bridgeToken: "tB" }), () => {}, new AbortController().signal);
    const mcp = seen[0]!.stderr!.mcp!;
    expect(Object.keys(mcp.mcpServers)).toEqual(["agenticview-r_B"]);
    expect(mcp.mcpServers["agenticview-r_B"]).toEqual({
      type: "local",
      command: process.execPath,
      args: ["C:/bridge/stdioBridge.js"],
      env: { AGENTICVIEW_BRIDGE_URL: "http://127.0.0.1:4242", AGENTICVIEW_RUN_ID: "r_B", AGENTICVIEW_BRIDGE_TOKEN: "tB" },
      tools: ["*"],
    });
    const args = seen[0]!.args;
    expect(args.join(" ")).toContain("--deny-tool write --deny-tool shell");
    expect(args[1]).toContain('MCP server "agenticview-r_B"');
    expect(args[1]).toContain("You may not create, edit or delete files");
    expect(await readdir(tmp)).toEqual([]);
  });

  it("puts a huge prompt in a file inside the run's temp dir", async () => {
    const seen: Seen[] = [];
    await rt(fakeSpawn("ok", seen)).run(req({ prompt: [{ type: "text", text: "x".repeat(40_000) }] }), () => {}, new AbortController().signal);
    expect(seen[0]!.args[1]).toMatch(/^The full task is in the file .*agenticview-copilot-r_1.*prompt\.md/);
  });

  it("surfaces the real CLI error line, not the JSON noise", async () => {
    const res = await rt(fakeSpawn("bogus-model")).run(req({ model: "bogus-model" }), () => {}, new AbortController().signal);
    expect(res).toMatchObject({ stopReason: "error", error: 'Error: Model "bogus-model" from --model flag is not available.' });
    const crash = await rt(fakeSpawn("crash")).run(req(), () => {}, new AbortController().signal);
    expect(crash.error).toMatch(/Authentication failed/);
    expect(classifyError(crash.error!)).toBe("auth");
  });

  it("retries once without effort when the model rejects it", async () => {
    const seen: Seen[] = [];
    const events: RunEvent[] = [];
    const res = await rt(fakeSpawn("effort-rejected", seen)).run(req({ model: "claude-haiku-4.5", effort: "max" }), (e) => events.push(e), new AbortController().signal);
    expect(res).toMatchObject({ stopReason: "done", text: "4" });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.args).not.toContain("--reasoning-effort");
    expect(events[0]).toEqual({ type: "status", text: "copilot: model claude-haiku-4.5 takes no reasoning effort; running without it" });
  });

  it("aborts a hanging run and kills the process tree", async () => {
    const ac = new AbortController();
    let started!: () => void;
    const first = new Promise<void>((r) => (started = r));
    const p = rt(fakeSpawn("hang"), { platform: "linux" }).run(req(), () => started(), ac.signal);
    await first;
    ac.abort();
    expect((await p).stopReason).toBe("aborted");
    expect(await readdir(tmp)).toEqual([]);
  }, 20000);
});

describe("CopilotRuntime.check", () => {
  it("finds copilot on PATH and reports its version", async () => {
    const spawn = ((_c: string, args: string[], opts: Record<string, unknown>) => nodeSpawn(process.execPath, [fakeCopilot, ...args], opts)) as never;
    expect(await rt(spawn).check()).toEqual({ provider: "copilot", ok: true, version: "copilot 1.0.88 (C:/tools/copilot.exe)" });
  });

  it("runs the npm .cmd shim's script with node", async () => {
    const shimDir = join(tmp, "npm");
    await mkdir(shimDir, { recursive: true });
    // The tail of the real shim npm writes for @github/copilot.
    await writeFile(join(shimDir, "copilot.cmd"), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n');
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return nodeSpawn(process.execPath, [fakeCopilot, ...args.slice(1)], opts);
    }) as never;
    const s = await rt(spawn, { which: async () => join(shimDir, "copilot.cmd") }).check();
    expect(s.ok).toBe(true);
    expect(calls[0]!.cmd).toBe(process.execPath);
    expect(calls[0]!.args[0]).toBe(join(shimDir, "node_modules", "@github", "copilot", "npm-loader.js"));
    expect(calls[0]!.args[1]).toBe("--version");
  });

  it("reports the install hint when copilot is missing", async () => {
    const s = await rt(fakeSpawn(), { which: async () => undefined }).check();
    expect(s).toMatchObject({ provider: "copilot", ok: false });
    expect(s.reason).toMatch(/npm i -g @github\/copilot/);
  });
});

describe("cleanupCopilotTemp", () => {
  it("removes only day-old AgenticView copilot run dirs", async () => {
    for (const n of ["agenticview-copilot-old", "agenticview-copilot-new", "other-old"]) await mkdir(join(tmp, n));
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await utimes(join(tmp, "agenticview-copilot-old"), old, old);
    await utimes(join(tmp, "other-old"), old, old);
    await cleanupCopilotTemp(tmp);
    expect((await readdir(tmp)).sort()).toEqual(["agenticview-copilot-new", "other-old"]);
  });
});

describe("copilot limit errors", () => {
  // Not observed live (a run costs ~0.4 AI credits, the smallest session cap is 30): patterns from
  // Copilot's billing/limits docs plus generic 429 / rate-limit text.
  it("classifies premium-request / AI-credit exhaustion as quota and 429s as rate limits", () => {
    expect(classifyError("You have exceeded your premium requests allowance for this month.")).toBe("quota");
    expect(classifyError("Session limits reached: 30/30 AI credits used.")).toBe("quota");
    expect(classifyError("You've hit your weekly rate limit for claude-opus-5.")).toBe("quota");
    expect(classifyError("CAPIError: 429 Too Many Requests")).toBe("rate-limit");
    expect(classifyError("Sorry, you have been rate limited. Please wait a moment.")).toBe("rate-limit");
    expect(extractCliError("some banner\nError: You have run out of premium requests.")).toBe("Error: You have run out of premium requests.");
  });
});
