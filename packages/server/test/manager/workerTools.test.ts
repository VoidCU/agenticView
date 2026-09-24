import { describe, it, expect } from "vitest";
import { defaultAgent } from "@agenticview/shared";
import { workerTools } from "../../src/manager/workerTools.js";
import { ScreenshotUnavailableError } from "../../src/screenshot/screenshot.js";
import { join } from "node:path";

const base = defaultAgent({ name: "N", role: "worker", scope: "project", specialty: "" });

describe("workerTools", () => {
  it("returns nothing when screenshots are not allowed", () => {
    expect(workerTools({ projectPath: "C:/p", agent: base })).toEqual([]);
  });

  it("exposes take_screenshot that writes under the project uploads dir", async () => {
    const agent = { ...base, tools: { ...base.tools, screenshot: true } };
    const calls: unknown[] = [];
    const tools = workerTools({ projectPath: "C:/p", agent, screenshot: async (url, outDir, opts) => { calls.push([url, outDir, opts]); return { path: `${outDir}/shot-u_00000001.png` }; } });
    expect(tools.map((t) => t.name)).toEqual(["take_screenshot"]);
    const out = await tools[0]!.handler({ url: "http://localhost:5173/", fullPage: true });
    expect(out).toBe(`screenshot: ${join("C:/p", ".agenticview", "uploads")}/shot-u_00000001.png`);
    expect(calls[0]).toEqual(["http://localhost:5173/", join("C:/p", ".agenticview", "uploads"), { fullPage: true }]);
  });

  it("returns the error text instead of throwing so the agent can read it", async () => {
    const agent = { ...base, tools: { ...base.tools, screenshot: true } };
    const tools = workerTools({ projectPath: "C:/p", agent, screenshot: async () => { throw new ScreenshotUnavailableError(); } });
    const out = await tools[0]!.handler({ url: "http://localhost/" });
    expect(out).toMatch(/^ERROR: .*npx playwright install chromium/);
  });
});
