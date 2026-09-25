import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defaultAgent } from "@agenticview/shared";
import { CodexRuntime, sandboxFor, type CodexSdk } from "../../src/runtimes/codex.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const agent = defaultAgent({ name: "C", role: "worker", scope: "project", specialty: "", provider: "codex" });

interface Capture {
  ctor?: Record<string, unknown>;
  threadOpts?: Record<string, unknown>;
  resumed?: string;
  input?: unknown;
}

const okEvents = [
  { type: "thread.started", thread_id: "th1" },
  { type: "turn.started" },
  { type: "item.started", item: { id: "i0", type: "reasoning", text: "hmm" } },
  { type: "item.completed", item: { id: "i0", type: "reasoning", text: "hmm" } },
  { type: "item.completed", item: { id: "i1", type: "agent_message", text: "Hi" } },
  { type: "item.completed", item: { id: "i2", type: "file_change", status: "completed", changes: [{ path: "a.ts", kind: "add" }, { path: "b.ts", kind: "update" }] } },
  { type: "item.started", item: { id: "i3", type: "command_execution", command: "npm test", status: "in_progress" } },
  { type: "item.completed", item: { id: "i3", type: "command_execution", command: "npm test", aggregated_output: "ok", exit_code: 0, status: "completed" } },
  { type: "item.started", item: { id: "i4", type: "mcp_tool_call", server: "agenticview", tool: "add", status: "in_progress", arguments: { a: 1 } } },
  { type: "item.completed", item: { id: "i4", type: "mcp_tool_call", server: "agenticview", tool: "add", status: "completed", result: { content: [{ type: "text", text: "1" }] } } },
  { type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 4 } },
];

function fakeSdk(cap: Capture, events: unknown[] = okEvents, opts: { throwOnRun?: boolean } = {}): CodexSdk {
  class Thread {
    id: string | null;
    constructor(id: string | null) { this.id = id; }
    async runStreamed(input: unknown) {
      cap.input = input;
      const self = this;
      if (opts.throwOnRun) throw new Error("codex exploded");
      return {
        events: (async function* () {
          for (const e of events) {
            if ((e as { type: string }).type === "thread.started") self.id = (e as { thread_id: string }).thread_id;
            yield e;
          }
        })(),
      };
    }
  }
  class Codex {
    constructor(o: Record<string, unknown>) { cap.ctor = o; }
    startThread(o: Record<string, unknown>) { cap.threadOpts = o; return new Thread(null); }
    resumeThread(id: string, o: Record<string, unknown>) { cap.resumed = id; cap.threadOpts = o; return new Thread(id); }
  }
  return { Codex } as unknown as CodexSdk;
}

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_1",
  agent,
  cwd: "C:/p",
  prompt: [{ type: "text", text: "do it" }],
  systemPrompt: "You are C.",
  tools: agent.tools,
  bridgeTools: [{ name: "add", description: "", schema: { a: z.number() }, handler: async () => "1" }],
  permissionMode: "auto-edit",
  bridgeToken: "t0k",
  ...over,
});

describe("CodexRuntime", () => {
  it("streams mapped events and returns the thread id as session", async () => {
    const cap: Capture = {};
    const rt = new CodexRuntime({ sdk: fakeSdk(cap), bridgeEntry: "C:/bridge.js", bridgeUrl: () => "http://127.0.0.1:1", which: async () => "codex" });
    const events: string[] = [];
    const res = await rt.run(req({ model: "gpt-5-codex" }), (e) => events.push(e.type), new AbortController().signal);
    expect(events).toEqual(["status", "text", "file_changed", "file_changed", "tool_start", "tool_end", "tool_start", "tool_end"]);
    expect(res).toMatchObject({ stopReason: "done", sessionId: "th1", text: "Hi", usage: { inputTokens: 3, outputTokens: 4 } });
    expect(cap.threadOpts).toMatchObject({ workingDirectory: "C:/p", skipGitRepoCheck: true, model: "gpt-5-codex", sandboxMode: process.platform === "win32" ? "danger-full-access" : "workspace-write" });
    const cfg = cap.ctor!.config as Record<string, any>;
    expect(cfg.mcp_servers.agenticview).toMatchObject({ command: process.execPath, args: ["C:/bridge.js"], env: { AGENTICVIEW_BRIDGE_URL: "http://127.0.0.1:1", AGENTICVIEW_RUN_ID: "r_1", AGENTICVIEW_BRIDGE_TOKEN: "t0k" } });
    expect(cfg.approval_policy).toBe("never");
    expect(cfg.mcp_servers.agenticview.default_tools_approval_mode).toBe("approve");
    expect(cap.input).toEqual([{ type: "text", text: "You are C.\n\ndo it" }]);
  });

  it("maps permission modes to sandbox modes, resumes threads, and sends images", async () => {
    const cap: Capture = {};
    const rt = new CodexRuntime({ sdk: fakeSdk(cap), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex", apiKey: "ck" });
    await rt.run(req({ permissionMode: "auto", sessionId: "th-prev", bridgeTools: [], prompt: [{ type: "text", text: "look" }, { type: "image", path: "C:/s/a.png" }] }), () => {}, new AbortController().signal);
    expect(cap.resumed).toBe("th-prev");
    expect(cap.threadOpts!.sandboxMode).toBe("danger-full-access");
    expect((cap.ctor!.config as Record<string, unknown>).mcp_servers).toBeUndefined();
    expect((cap.ctor!.env as Record<string, string>).CODEX_API_KEY).toBe("ck");
    expect(cap.input).toEqual([{ type: "text", text: "You are C.\n\nlook" }, { type: "local_image", path: "C:/s/a.png" }]);
    const cap2: Capture = {};
    await new CodexRuntime({ sdk: fakeSdk(cap2), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req({ permissionMode: "ask" }), () => {}, new AbortController().signal);
    expect(cap2.threadOpts!.sandboxMode).toBe("read-only");
  });

  it("reports turn failures, errors, and thrown SDK errors", async () => {
    const failed = [{ type: "thread.started", thread_id: "t2" }, { type: "item.completed", item: { type: "agent_message", text: "partial" } }, { type: "turn.failed", error: { message: "rate limited" } }];
    const res = await new CodexRuntime({ sdk: fakeSdk({}, failed), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), () => {}, new AbortController().signal);
    expect(res).toMatchObject({ stopReason: "error", error: "rate limited", text: "partial", sessionId: "t2" });
    const errEv = [{ type: "error", message: "stream broke" }];
    const res2 = await new CodexRuntime({ sdk: fakeSdk({}, errEv), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), () => {}, new AbortController().signal);
    expect(res2).toMatchObject({ stopReason: "error", error: "stream broke" });
    const res3 = await new CodexRuntime({ sdk: fakeSdk({}, [], { throwOnRun: true }), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), () => {}, new AbortController().signal);
    expect(res3).toMatchObject({ stopReason: "error", error: "codex exploded" });
  });

  it("aborts", async () => {
    const slow = { events: [{ type: "thread.started", thread_id: "t3" }] };
    const sdk = fakeSdk({}, slow.events);
    const ac = new AbortController();
    ac.abort();
    const res = await new CodexRuntime({ sdk, bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), () => {}, ac.signal);
    expect(res.stopReason).toBe("aborted");
  });

  it("check reports the install reason when the codex CLI is missing", async () => {
    const s = await new CodexRuntime({ sdk: fakeSdk({}), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => undefined }).check();
    expect(s).toMatchObject({ provider: "codex", ok: false });
    expect(s.reason).toMatch(/Codex CLI/);
    expect((await new CodexRuntime({ sdk: fakeSdk({}), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "/bin/codex" }).check()).ok).toBe(true);
  });
});

describe("CodexRuntime edge cases", () => {
  it("does not report file changes when the patch failed", async () => {
    const evs = [
      { type: "thread.started", thread_id: "t9" },
      { type: "item.completed", item: { id: "f", type: "file_change", status: "failed", changes: [{ path: "a.ts", kind: "add" }] } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const seen: unknown[] = [];
    await new CodexRuntime({ sdk: fakeSdk({}, evs), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), (e) => seen.push(e), new AbortController().signal);
    expect(seen).toEqual([{ type: "status", text: "patch failed: a.ts" }]);
  });

  it("separates consecutive agent messages in the result text", async () => {
    const evs = [
      { type: "thread.started", thread_id: "t10" },
      { type: "item.completed", item: { id: "m1", type: "agent_message", text: "I'll do it." } },
      { type: "item.completed", item: { id: "m2", type: "agent_message", text: "Done." } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const res = await new CodexRuntime({ sdk: fakeSdk({}, evs), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req(), () => {}, new AbortController().signal);
    expect(res.text).toBe("I'll do it.\n\nDone.");
  });

  it("forces a read-only sandbox when the agent may neither edit nor run commands", async () => {
    const cap: Capture = {};
    const manager = { ...agent, tools: { edit: false, shell: false, web: false, screenshot: false } };
    await new CodexRuntime({ sdk: fakeSdk(cap), bridgeEntry: "b", bridgeUrl: () => "u", which: async () => "codex" }).run(req({ agent: manager, tools: manager.tools, permissionMode: "auto" }), () => {}, new AbortController().signal);
    expect(cap.threadOpts!.sandboxMode).toBe("read-only");
    expect(sandboxFor("auto", "linux", { edit: false, shell: false, web: false, screenshot: false })).toBe("read-only");
    expect(sandboxFor("auto", "linux", { edit: false, shell: true, web: false, screenshot: false })).toBe("danger-full-access");
  });

  it("maps auto-edit per platform and never uses the sandbox for auto", () => {
    expect(sandboxFor("auto", "win32")).toBe("danger-full-access");
    expect(sandboxFor("auto", "linux")).toBe("danger-full-access");
    expect(sandboxFor("auto-edit", "win32")).toBe("danger-full-access");
    expect(sandboxFor("auto-edit", "linux")).toBe("workspace-write");
    expect(sandboxFor("auto-edit", "darwin")).toBe("workspace-write");
    expect(sandboxFor("ask", "win32")).toBe("read-only");
    expect(sandboxFor("ask", "linux")).toBe("read-only");
  });
});
