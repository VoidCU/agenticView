import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import { z } from "zod";
import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolRegistry } from "../../src/bridge/toolRegistry.js";
import { bridgeRoutes } from "../../src/bridge/httpBridge.js";
import { bridgeEntryPath } from "../../src/runtimes/index.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const bridgeJs = join(repoRoot, "packages/server/dist/bridge/stdioBridge.js");

let http: Server;
let url: string;
const registry = new ToolRegistry();

beforeAll(async () => {
  execSync("npx tsc -b packages/server", { cwd: repoRoot, stdio: "inherit" });
  const app = new Hono();
  app.route("/", bridgeRoutes(registry));
  http = createAdaptorServer({ fetch: app.fetch }) as Server;
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const addr = http.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120000);
afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
});

async function connect(runId: string, token: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bridgeJs],
    env: { ...(process.env as Record<string, string>), AGENTICVIEW_BRIDGE_URL: url, AGENTICVIEW_RUN_ID: runId, AGENTICVIEW_BRIDGE_TOKEN: token },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("stdio MCP bridge (real process)", () => {
  it("lists the run's tools and proxies calls, including validation errors", async () => {
    const { token } = registry.register("r_std", [
      { name: "add", description: "adds two numbers", schema: { a: z.number(), b: z.number() }, handler: async (x) => String(Number(x.a) + Number(x.b)) },
      { name: "shout", description: "", schema: { s: z.string(), times: z.number().optional() }, handler: async (x) => String(x.s).toUpperCase().repeat(Number(x.times ?? 1)) },
    ]);
    const client = await connect("r_std", token);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual(["add", "shout"]);
      expect(tools.tools.find((t) => t.name === "add")!.description).toBe("adds two numbers");
      const ok = await client.callTool({ name: "add", arguments: { a: 2, b: 3 } });
      expect((ok.content as { type: string; text: string }[])[0]!.text).toBe("5");
      expect(ok.isError).toBeFalsy();
      const twice = await client.callTool({ name: "shout", arguments: { s: "hi", times: 2 } });
      expect((twice.content as { text: string }[])[0]!.text).toBe("HIHI");
      const bad = await client.callTool({ name: "add", arguments: { a: "x", b: 1 } });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toMatch(/Invalid arguments|invalid_type|expected number/i);
    } finally {
      await client.close();
      registry.release("r_std");
    }
  }, 30000);

  it("exits with a non-zero code when the run token is wrong", async () => {
    registry.register("r_bad", [{ name: "x", description: "", schema: {}, handler: async () => "" }]);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bridgeJs],
      env: { ...(process.env as Record<string, string>), AGENTICVIEW_BRIDGE_URL: url, AGENTICVIEW_RUN_ID: "r_bad", AGENTICVIEW_BRIDGE_TOKEN: "wrong" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await expect(client.connect(transport)).rejects.toThrow();
    registry.release("r_bad");
  }, 30000);
});
