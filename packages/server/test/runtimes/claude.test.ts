import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgent } from "@agenticview/shared";
import { ClaudeRuntime, claudeOptionsFor, mapClaudeMessage, type ClaudeSdk } from "../../src/runtimes/claude.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const agent = defaultAgent({ name: "N", role: "worker", scope: "project", specialty: "" });
const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "r_1",
  agent,
  cwd: "C:/p",
  prompt: [{ type: "text", text: "do it" }],
  systemPrompt: "You are Nova.",
  tools: agent.tools,
  bridgeTools: [{ name: "add", description: "", schema: { a: z.number() }, handler: async () => "1" }],
  permissionMode: "auto-edit",
  ...over,
});

const script = [
  { type: "system", subtype: "init", session_id: "s1" },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Working" },
        { type: "tool_use", id: "tu1", name: "Write", input: { file_path: "a.txt", content: "x" } },
      ],
    },
  },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } },
  { type: "result", subtype: "success", result: "Done.", session_id: "s1", total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 }, num_turns: 1 },
];

interface Capture {
  options?: Record<string, unknown>;
  prompt?: unknown;
}

function fakeSdk(capture: Capture, messages: unknown[] = script): ClaudeSdk {
  return {
    query: (({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
      capture.options = options;
      capture.prompt = prompt;
      return (async function* () {
        for (const m of messages) yield m;
      })();
    }) as never,
    tool: ((name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler })) as never,
    createSdkMcpServer: ((cfg: { name: string; tools: unknown[] }) => ({ type: "sdk", name: cfg.name, instance: cfg })) as never,
  };
}

const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_ANTHROPIC_AWS"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("claudeOptionsFor", () => {
  it("maps tool allowance and permission mode", () => {
    const o = claudeOptionsFor(req());
    expect(o.allowedTools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "Bash", "mcp__agenticview__add"]));
    expect(o.disallowedTools).toEqual(["WebSearch", "WebFetch"]);
    expect(o.permissionMode).toBe("acceptEdits");
    expect(claudeOptionsFor(req({ permissionMode: "auto" })).permissionMode).toBe("bypassPermissions");
    expect(claudeOptionsFor(req({ permissionMode: "ask" })).permissionMode).toBe("default");
    const ro = claudeOptionsFor(req({ tools: { edit: false, shell: false, web: true, screenshot: false } }));
    expect(ro.disallowedTools).toEqual(["Edit", "Write", "MultiEdit", "Bash"]);
    expect(ro.allowedTools).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
    expect(ro.allowedTools).not.toContain("Edit");
  });
});

describe("ClaudeRuntime.run", () => {
  it("streams mapped events and returns a result", async () => {
    const cap: Capture = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap), apiKey: "k" });
    const events: string[] = [];
    const res = await rt.run({ ...req(), sessionId: "prev", model: "claude-opus-5" }, (e) => events.push(e.type), new AbortController().signal);
    expect(events).toEqual(["text", "tool_start", "tool_end", "file_changed"]);
    expect(res).toMatchObject({ text: "Done.", stopReason: "done", sessionId: "s1", costUsd: 0.01, usage: { inputTokens: 5, outputTokens: 7 } });
    expect(cap.options).toMatchObject({ cwd: "C:/p", resume: "prev", permissionMode: "acceptEdits", model: "claude-opus-5", maxTurns: 60 });
    expect(cap.options!.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "You are Nova." });
    expect((cap.options!.mcpServers as Record<string, unknown>).agenticview).toBeDefined();
    expect(cap.options!.abortController).toBeInstanceOf(AbortController);
  });

  it("omits mcpServers when there are no bridge tools and sends images as base64 blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-img-"));
    const png = join(dir, "shot.png");
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const cap: Capture = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap), apiKey: "k" });
    await rt.run(req({ bridgeTools: [], prompt: [{ type: "text", text: "look" }, { type: "image", path: png }] }), () => {}, new AbortController().signal);
    expect(cap.options!.mcpServers).toBeUndefined();
    const msgs: unknown[] = [];
    for await (const m of cap.prompt as AsyncIterable<unknown>) msgs.push(m);
    expect(msgs).toHaveLength(1);
    const content = (msgs[0] as { message: { content: unknown[] } }).message.content;
    expect(content[0]).toEqual({ type: "text", text: "look" });
    expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") } });
    await rm(dir, { recursive: true, force: true });
  });

  it("asks the user in ask mode and denies when nobody answers", async () => {
    const cap: Capture = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap), apiKey: "k" });
    const asked: string[] = [];
    await rt.run({ ...req({ permissionMode: "ask" }), onPermission: async (p) => { asked.push(p.tool); return false; } }, () => {}, new AbortController().signal);
    const canUse = cap.options!.canUseTool as (n: string, i: unknown, o: unknown) => Promise<{ behavior: string }>;
    expect((await canUse("Bash", { command: "rm" }, { signal: new AbortController().signal })).behavior).toBe("deny");
    expect(asked).toEqual(["Bash"]);
    const cap2: Capture = {};
    await new ClaudeRuntime({ sdk: fakeSdk(cap2), apiKey: "k" }).run(req({ permissionMode: "ask" }), () => {}, new AbortController().signal);
    const canUse2 = cap2.options!.canUseTool as typeof canUse;
    expect((await canUse2("Bash", {}, {})).behavior).toBe("deny");
    const cap3: Capture = {};
    await new ClaudeRuntime({ sdk: fakeSdk(cap3), apiKey: "k" }).run({ ...req({ permissionMode: "ask" }), onPermission: async () => true }, () => {}, new AbortController().signal);
    const canUse3 = cap3.options!.canUseTool as (n: string, i: unknown, o: unknown) => Promise<{ behavior: string; updatedInput?: unknown }>;
    expect(await canUse3("Bash", { command: "ls" }, {})).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("maps error subtypes and max turns", async () => {
    const cap: Capture = {};
    const rt = new ClaudeRuntime({ sdk: fakeSdk(cap, [{ type: "result", subtype: "error_max_turns", session_id: "s2", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, num_turns: 60 }]), apiKey: "k" });
    const res = await rt.run(req(), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("max_turns");
    const rt2 = new ClaudeRuntime({ sdk: fakeSdk({}, [{ type: "result", subtype: "error_during_execution", session_id: "s3", errors: ["boom"], total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, num_turns: 1 }]), apiKey: "k" });
    const res2 = await rt2.run(req(), () => {}, new AbortController().signal);
    expect(res2.stopReason).toBe("error");
    expect(res2.error).toMatch(/error_during_execution|boom/);
  });

  it("reports a thrown SDK error and an abort", async () => {
    const throwing: ClaudeSdk = { ...fakeSdk({}), query: (() => { throw new Error("sdk exploded"); }) as never };
    const res = await new ClaudeRuntime({ sdk: throwing, apiKey: "k" }).run(req(), () => {}, new AbortController().signal);
    expect(res.stopReason).toBe("error");
    expect(res.error).toBe("sdk exploded");
    const ac = new AbortController();
    ac.abort();
    const res2 = await new ClaudeRuntime({ sdk: throwing, apiKey: "k" }).run(req(), () => {}, ac.signal);
    expect(res2.stopReason).toBe("aborted");
  });

  it("check reports the missing key reason and accepts any credential env", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const s = await new ClaudeRuntime({ sdk: fakeSdk({}) }).check();
    expect(s).toMatchObject({ provider: "claude", ok: false });
    expect(s.reason).toMatch(/ANTHROPIC_API_KEY/);
    expect((await new ClaudeRuntime({ sdk: fakeSdk({}), apiKey: "k" }).check()).ok).toBe(true);
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    expect((await new ClaudeRuntime({ sdk: fakeSdk({}) }).check()).ok).toBe(true);
  });

  it("exports the configured api key only for the duration of a run", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    let seen: string | undefined;
    const sdk: ClaudeSdk = { ...fakeSdk({}), query: (() => { seen = process.env.ANTHROPIC_API_KEY; return (async function* () { yield script[3]; })(); }) as never };
    await new ClaudeRuntime({ sdk, apiKey: "secret" }).run(req(), () => {}, new AbortController().signal);
    expect(seen).toBe("secret");
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

it("mapClaudeMessage ignores unknown messages", () => {
  const seen = new Map();
  expect(mapClaudeMessage({ type: "system", subtype: "compact_boundary" }, seen)).toEqual([]);
  expect(mapClaudeMessage({ type: "stream_event" }, seen)).toEqual([]);
});
