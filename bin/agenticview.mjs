#!/usr/bin/env node
/**
 * Dependency-free bootstrap. Installs production dependencies on first run, then hands over to
 * the built CLI at packages/server/dist/cli.js.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "packages", "server", "dist", "cli.js");

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`AgenticView needs Node 22 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

if (!existsSync(join(root, "node_modules", "@hono", "node-server"))) {
  console.error("Installing AgenticView dependencies (first run)...");
  const r = spawnSync("npm install --omit=dev --no-audit --no-fund", { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("npm install failed. Run it manually in " + root);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(cli)) {
  console.error(`AgenticView is not built (missing ${cli}). Run: npm install && npm run build`);
  process.exit(1);
}

const { main } = await import(pathToFileURL(cli).href);
const code = await main(process.argv.slice(2));
if (code !== 0) process.exit(code);
if (process.argv[2] !== "open" && process.argv[2] !== "hub") process.exit(0);
