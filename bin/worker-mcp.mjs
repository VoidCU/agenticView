#!/usr/bin/env node
/**
 * Dependency-free bootstrap for the /agenticview-work MCP server (declared in the plugin's
 * .mcp.json). stdout belongs to the MCP protocol, so first-run installs log to stderr only.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "packages", "server", "dist", "worker-mcp.js");

if (!existsSync(join(root, "node_modules", "@modelcontextprotocol", "sdk"))) {
  console.error("AgenticView worker: installing dependencies (first run)...");
  const r = spawnSync("npm install --omit=dev --no-audit --no-fund", { cwd: root, stdio: ["ignore", 2, 2], shell: true });
  if (r.status !== 0) {
    console.error("AgenticView worker: npm install failed. Run it manually in " + root);
    process.exit(r.status ?? 1);
  }
}
if (!existsSync(entry)) {
  console.error(`AgenticView worker: not built (missing ${entry}). Run: npm install && npm run build`);
  process.exit(1);
}

const { main } = await import(pathToFileURL(entry).href);
await main();
