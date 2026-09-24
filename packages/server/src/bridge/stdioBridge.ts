#!/usr/bin/env node
/**
 * MCP stdio server spawned by the Codex and Gemini runtimes. It fetches the run's tool list from
 * the AgenticView server and proxies every call back over localhost HTTP.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { jsonSchemaToZodShape } from "./jsonSchemaToZod.js";
import type { ToolDescription } from "./toolRegistry.js";

const url = process.env.AGENTICVIEW_BRIDGE_URL;
const runId = process.env.AGENTICVIEW_RUN_ID;
const token = process.env.AGENTICVIEW_BRIDGE_TOKEN;
if (!url || !runId || !token) {
  console.error("agenticview bridge: AGENTICVIEW_BRIDGE_URL, AGENTICVIEW_RUN_ID and AGENTICVIEW_BRIDGE_TOKEN are required");
  process.exit(2);
}

const headers = { "x-bridge-token": token, "content-type": "application/json" };
const listRes = await fetch(`${url}/bridge/${runId}/tools`, { headers });
if (!listRes.ok) {
  console.error(`agenticview bridge: tool list failed (${listRes.status})`);
  process.exit(3);
}
const tools = (await listRes.json()) as ToolDescription[];

const server = new McpServer({ name: "agenticview", version: "0.1.0" });
for (const t of tools) {
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: jsonSchemaToZodShape(t.inputSchema) },
    async (args: Record<string, unknown>) => {
      const res = (await (
        await fetch(`${url}/bridge/${runId}/call`, { method: "POST", headers, body: JSON.stringify({ name: t.name, args }) })
      ).json()) as { ok: boolean; result?: string; error?: string };
      return { content: [{ type: "text" as const, text: res.ok ? (res.result ?? "") : `ERROR: ${res.error}` }], isError: !res.ok };
    },
  );
}
await server.connect(new StdioServerTransport());
