#!/usr/bin/env node
/**
 * Dependency-free bootstrap for the /agenticview-work MCP server (declared in the plugin's
 * .mcp.json). stdout belongs to the MCP protocol, so first-run installs log to stderr only.
 *
 * A fresh plugin install has no node_modules, and `npm install` takes longer than Claude Code
 * waits for an MCP handshake. So on first run we start the install in the background and answer
 * the protocol ourselves with a stub whose tools say "installing, reconnect shortly", instead of
 * blocking the handshake until Claude Code gives up and closes the connection.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "packages", "server", "dist", "worker-mcp.js");
const installed = () => existsSync(join(root, "node_modules", "@modelcontextprotocol", "sdk"));

if (!existsSync(entry)) {
  console.error(`AgenticView worker: not built (missing ${entry}). Run: npm install && npm run build`);
  process.exit(1);
}

if (installed()) {
  const { main } = await import(pathToFileURL(entry).href);
  await main();
} else {
  serveWhileInstalling();
}

function serveWhileInstalling() {
  let state = "installing";
  let failure = "";
  console.error("AgenticView worker: installing dependencies (first run)...");
  const child = spawn("npm install --omit=dev --no-audit --no-fund", { cwd: root, stdio: ["ignore", 2, 2], shell: true });
  child.on("exit", (code) => {
    state = code === 0 && installed() ? "ready" : "failed";
    if (state === "failed") failure = `npm install exited with ${code}. Run it manually in ${root}`;
    console.error(`AgenticView worker: dependency install ${state}.`);
  });

  const message = () =>
    state === "ready"
      ? "AgenticView worker finished installing. Reconnect it (run /mcp, pick agenticview-worker, Reconnect) and run /agenticview-work again."
      : state === "failed"
        ? `AgenticView worker could not install its dependencies: ${failure}`
        : "AgenticView worker is installing its dependencies (first run, about a minute). Then reconnect it (run /mcp, pick agenticview-worker, Reconnect) and run /agenticview-work again.";
  const names = ["agenticview_next_task", "agenticview_report", "agenticview_complete", "agenticview_bridge"];
  const tools = names.map((name) => ({ name, description: "AgenticView worker (still starting up; call for status).", inputSchema: { type: "object", properties: {}, additionalProperties: true } }));
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

  createInterface({ input: process.stdin }).on("line", (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    if (req.id === undefined) return; // notifications
    const ok = (result) => send({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "initialize") ok({ protocolVersion: req.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agenticview-worker", version: "bootstrap" } });
    else if (req.method === "tools/list") ok({ tools });
    else if (req.method === "tools/call") ok({ content: [{ type: "text", text: message() }], isError: state !== "ready" });
    else if (req.method === "ping") ok({});
    else send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  });
}
