#!/usr/bin/env node
/**
 * Dependency-free hook handler used by the Claude Code plugin hooks and by `agenticview hook`.
 *
 *   node hook.mjs mirror              reads a hook JSON payload from stdin, posts it to a running
 *                                     AgenticView server (matched by cwd), always exits 0 fast
 *   node hook.mjs record-root <path>  writes <path> to ~/.agenticview/plugin-root
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 250;

export function globalRoot() {
  return process.env.AGENTICVIEW_HOME ?? join(homedir(), ".agenticview");
}

function clip(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) : s;
}

/** Map a Claude Code hook payload to `{ kind, text }`, or undefined when it is not recognised. */
export function formatHookEvent(payload) {
  const kind = payload?.hook_event_name;
  if (typeof kind !== "string") return undefined;
  switch (kind) {
    case "UserPromptSubmit":
      return { kind, text: `You: ${clip(payload.prompt, 120)}` };
    case "PostToolUse": {
      const input = payload.tool_input ?? {};
      const detail = input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.query ?? "";
      return { kind, text: clip(`${payload.tool_name ?? "tool"} ${detail}`, 100) };
    }
    case "SessionStart":
      return { kind, text: "Session started" };
    case "SessionEnd":
      return { kind, text: "Session ended" };
    default:
      return { kind, text: clip(kind, 100) };
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let data = "";
    const done = () => resolve(data);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    setTimeout(done, 100).unref();
  });
}

/** Live instance files, preferring the one whose projectPath equals cwd. */
export async function findInstances(cwd) {
  const dir = join(globalRoot(), "instances");
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(await readFile(join(dir, n), "utf8")));
    } catch {
      /* ignore unreadable instance files */
    }
  }
  const norm = (p) => String(p ?? "").replace(/[\\/]+$/, "").toLowerCase();
  return out.sort((a, b) => Number(norm(b.projectPath) === norm(cwd)) - Number(norm(a.projectPath) === norm(cwd)));
}

export async function mirror(stdinText) {
  let payload;
  try {
    payload = JSON.parse(stdinText || "{}");
  } catch {
    return false;
  }
  const event = formatHookEvent(payload);
  if (!event) return false;
  const instances = await findInstances(payload.cwd ?? process.cwd());
  const target = instances[0];
  if (!target?.url || !target.token) return false;
  try {
    const res = await fetch(`${target.url}/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agenticview-token": target.token },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function recordRoot(path) {
  const root = globalRoot();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "plugin-root"), String(path), "utf8");
}

export async function runHook(argv) {
  const [cmd, arg] = argv;
  if (cmd === "record-root" && arg) {
    await recordRoot(arg);
    return 0;
  }
  if (cmd === "mirror") {
    await mirror(await readStdin());
    return 0;
  }
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const guard = setTimeout(() => process.exit(0), 290);
  guard.unref();
  runHook(process.argv.slice(2)).then(
    (code) => process.exit(code),
    () => process.exit(0),
  );
}
