// Fake `copilot` CLI used by copilot.test.ts. Prints {argv, cwd, mcp} to stderr as JSON (mcp = the
// --additional-mcp-config file's contents), writes a usage report when asked, then replays a recorded
// copilot JSONL fixture on stdout.
// Env FAKE_COPILOT_MODE: "ok" (default) | "bogus-model" | "effort-rejected" | "hang" | "crash"
// Env FAKE_COPILOT_FIXTURE: fixture file for "ok" (default copilot-edit-shell.ndjson)
// Env FAKE_COPILOT_USAGE: JSON of the usage report to write (default copilot-usage.json)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_COPILOT_MODE ?? "ok";
const here = import.meta.dirname;
const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  process.stdout.write("GitHub Copilot CLI 1.0.88.\nRun 'copilot update' to check for updates.\n");
  process.exit(0);
}
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
let mcp;
const mcpArg = opt("--additional-mcp-config");
if (mcpArg?.startsWith("@")) mcp = JSON.parse(readFileSync(mcpArg.slice(1), "utf8"));
console.error(JSON.stringify({ argv, cwd: process.cwd(), mcp }));

if (mode === "bogus-model") {
  process.stdout.write(readFileSync(join(here, "copilot-bogus-model.ndjson"), "utf8"));
  process.stderr.write(readFileSync(join(here, "copilot-bogus-model.stderr.txt"), "utf8"));
  process.exit(1);
}
if (mode === "effort-rejected" && argv.includes("--reasoning-effort")) {
  process.stderr.write(`Error: Model "${opt("--model")}" does not support reasoning effort configuration (requested: "${opt("--reasoning-effort")}").\n`);
  process.exit(1);
}
if (mode === "crash") {
  console.error("Error: Authentication failed. Run `copilot login`.");
  process.exit(2);
}
const usageFile = opt("--usage-output-file");
if (usageFile) writeFileSync(usageFile, process.env.FAKE_COPILOT_USAGE ?? readFileSync(join(here, "copilot-usage.json"), "utf8"));
if (mode === "hang") {
  process.stdout.write(
    JSON.stringify({ type: "tool.execution_start", data: { toolCallId: "c1", toolName: "powershell", arguments: { command: "sleep 100" } } }) + "\n",
  );
  setInterval(() => undefined, 1000);
} else {
  const fixture = mode === "effort-rejected" ? "copilot-plain.ndjson" : (process.env.FAKE_COPILOT_FIXTURE ?? "copilot-edit-shell.ndjson");
  process.stdout.write(readFileSync(join(here, fixture), "utf8"));
  process.exit(0);
}
