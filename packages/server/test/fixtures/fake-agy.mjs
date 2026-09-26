// Fake `agy` CLI used by antigravity.test.ts. Prints {argv, cwd, plugins} to stderr as JSON, then replays
// a recorded agy stream-json fixture on stdout.
// Env FAKE_AGY_MODE: "ok" (default, replays agy-edit-run.ndjson) | "error" | "hang" | "crash" | "version"
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_AGY_MODE ?? "ok";
const here = import.meta.dirname;
if (process.argv.includes("--version")) {
  process.stdout.write("1.2.11\n");
  process.exit(0);
}
let plugins = [];
try {
  plugins = readdirSync(join(process.cwd(), ".agents", "plugins"));
} catch {
  plugins = [];
}
console.error(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), plugins }));

if (mode === "error") {
  process.stdout.write(JSON.stringify({ event: "result", result: { conversation_id: "", status: "ERROR", response: "", error: "invalid model selection", usage: { input_tokens: 0, output_tokens: 0 } } }) + "\n");
  process.exit(1);
}
if (mode === "crash") {
  console.error("boom");
  process.exit(2);
}
if (mode === "hang") {
  process.stdout.write(JSON.stringify({ event: "init", conversation_id: "c-hang", init: {} }) + "\n");
  // A tool step so the abort test can wait for an observable event before aborting (a bare init
  // produces none, and under load the 300 ms abort could beat process startup).
  process.stdout.write(
    JSON.stringify({ event: "step_update", step_update: { conversation_id: "c-hang", step_index: 1, state: "ACTIVE", step_type: "tool", tool_name: "wait", tool_info: { name: "wait", parameters: {} } } }) + "\n",
  );
  setInterval(() => undefined, 1000);
} else {
  process.stdout.write(readFileSync(join(here, process.env.FAKE_AGY_FIXTURE ?? "agy-edit-run.ndjson"), "utf8"));
  process.exit(0);
}
