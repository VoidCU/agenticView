import { it, expect } from "vitest";
import { z } from "zod";
import { defaultAgent } from "@agenticview/shared";
import { FakeRuntime } from "../../src/runtimes/fake.js";
import type { RunRequest } from "../../src/runtimes/types.js";

const agent = defaultAgent({ name: "N", role: "worker", scope: "project", specialty: "" });
const base: RunRequest = {
  runId: "r_1",
  agent,
  cwd: ".",
  prompt: [{ type: "text", text: "hi" }],
  systemPrompt: "",
  tools: agent.tools,
  bridgeTools: [],
  permissionMode: "auto",
};

it("streams scripted events and calls bridge tools", async () => {
  const seen: string[] = [];
  const rt = new FakeRuntime(async function* () {
    yield { type: "text", text: "Hello " };
    yield { type: "call", tool: "echo", args: { s: "x" } };
    yield { type: "call", tool: "nope", args: {} };
    yield { type: "text", text: "world" };
  });
  const res = await rt.run(
    {
      ...base,
      bridgeTools: [
        {
          name: "echo",
          description: "",
          schema: { s: z.string() },
          handler: async (a) => {
            seen.push(String(a.s));
            return "ok";
          },
        },
      ],
    },
    (e) => seen.push(e.type),
    new AbortController().signal,
  );
  expect(res.text).toBe("Hello world");
  expect(res.stopReason).toBe("done");
  expect(res.sessionId).toBe("fake-r_1");
  expect(seen).toEqual(["text", "tool_start", "x", "tool_end", "tool_start", "tool_end", "text"]);
  expect(rt.runs).toHaveLength(1);
  expect(rt.provider).toBe("claude");
});

it("reports a tool handler error without stopping the run", async () => {
  const ends: unknown[] = [];
  const rt = new FakeRuntime(async function* () {
    yield { type: "call", tool: "boom", args: {} };
    yield { type: "text", text: "after" };
  });
  const res = await rt.run(
    { ...base, bridgeTools: [{ name: "boom", description: "", schema: {}, handler: async () => { throw new Error("bad"); } }] },
    (e) => { if (e.type === "tool_end") ends.push(e); },
    new AbortController().signal,
  );
  expect(ends).toEqual([{ type: "tool_end", name: "boom", ok: false, summary: "bad" }]);
  expect(res.text).toBe("after");
});

it("aborts", async () => {
  const rt = new FakeRuntime(async function* () {
    yield { type: "text", text: "a" };
    await new Promise((r) => setTimeout(r, 1000));
    yield { type: "text", text: "b" };
  });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  const res = await rt.run(base, () => {}, ac.signal);
  expect(res.stopReason).toBe("aborted");
  expect(res.text).toBe("a");
});

it("reports a script error", async () => {
  const rt = new FakeRuntime(async function* () {
    yield { type: "text", text: "x" };
    throw new Error("script failed");
  });
  const res = await rt.run(base, () => {}, new AbortController().signal);
  expect(res.stopReason).toBe("error");
  expect(res.error).toBe("script failed");
});

it("resumes a session id when given", async () => {
  const rt = new FakeRuntime(async function* () { yield { type: "text", text: "x" }; });
  const res = await rt.run({ ...base, sessionId: "s-prev" }, () => {}, new AbortController().signal);
  expect(res.sessionId).toBe("s-prev");
});
