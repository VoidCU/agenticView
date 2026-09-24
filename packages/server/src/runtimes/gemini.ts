import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import type { PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { which as defaultWhich, type Which } from "./which.js";

export interface GeminiRuntimeOptions {
  bin?: string;
  bridgeEntry: string;
  bridgeUrl: () => string;
  apiKey?: string;
  spawn?: typeof nodeSpawn;
  which?: Which;
}

export const GEMINI_MISSING_REASON = "Install the Gemini CLI (npm i -g @google/gemini-cli) and sign in, or set GEMINI_API_KEY.";

/** `ask` cannot prompt through a headless CLI, so it gets the CLI's own most restrictive mode (`default`). */
const APPROVAL: Record<PermissionMode, string> = { auto: "yolo", "auto-edit": "auto_edit", ask: "default" };
const WRITE_TOOLS = new Set(["write_file", "replace", "edit", "edit_file"]);
/** Prompts longer than this go on stdin; Windows limits a command line to 32 K characters. */
const MAX_ARG_PROMPT = 30_000;
const STDIN_MARKER = "The full task is provided on standard input above. Follow it.";
const ENTRY_PREFIX = "agenticview-";
const MARKER_KEY = "agenticview";

/** Gemini tool names to exclude for each allowance that is off. */
export function excludedToolsFor(tools: ToolAllowance): string[] {
  const out: string[] = [];
  if (!tools.edit) out.push("write_file", "replace", "edit");
  if (!tools.shell) out.push("run_shell_command");
  if (!tools.web) out.push("google_web_search", "web_fetch");
  return out;
}

/**
 * npm installs CLIs on Windows as `.cmd` shims that Node cannot spawn directly. Resolve the shim's
 * target script so we can run it with `process.execPath`. Returns undefined when the file is not a shim.
 */
export async function resolveNodeShim(bin: string): Promise<string | undefined> {
  if (!/\.(cmd|bat)$/i.test(bin)) return undefined;
  try {
    const body = await readFile(bin, "utf8");
    const m = body.match(/"%dp0%\\([^"]+?\.(?:m?js|cjs))"/i);
    if (!m) return undefined;
    // The shim spells its target with backslashes; normalise so this also resolves on POSIX (tests, WSL).
    return join(dirname(bin), ...m[1]!.split(/[\\/]+/));
  } catch {
    return undefined;
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  return "";
}

/** Pure mapping from one Gemini stream-json line to RunEvents. Returns `result` when the line is the final result. */
export function mapGeminiLine(line: string): { events: RunEvent[]; sessionId?: string; result?: { ok: boolean; error?: string } } {
  const events: RunEvent[] = [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return { events: line.trim() ? [{ type: "status", text: line.trim().slice(0, 200) }] : [] };
  }
  if (!obj || typeof obj !== "object") return { events };
  switch (obj.type) {
    case "init":
      return { events, sessionId: typeof obj.session_id === "string" ? obj.session_id : undefined };
    case "message": {
      if (obj.role === "assistant") {
        const t = contentText(obj.content);
        if (t) events.push({ type: "text", text: t });
      }
      break;
    }
    case "tool_use": {
      const name = String(obj.name ?? obj.tool_name ?? "tool");
      const input = (obj.input ?? obj.args ?? obj.parameters ?? {}) as Record<string, unknown>;
      events.push({ type: "tool_start", name, input });
      const filePath = input.file_path ?? input.path;
      if (WRITE_TOOLS.has(name) && typeof filePath === "string") events.push({ type: "file_changed", path: filePath, kind: name === "write_file" ? "create" : "modify" });
      break;
    }
    case "tool_result": {
      const name = String(obj.name ?? obj.tool_name ?? "tool");
      const ok = obj.status !== "error" && obj.is_error !== true;
      events.push({ type: "tool_end", name, ok, summary: contentText(obj.output ?? obj.content ?? obj.result ?? "").slice(0, 200) });
      break;
    }
    case "error":
      events.push({ type: "status", text: `error: ${String(obj.message ?? obj.error ?? "unknown")}` });
      break;
    case "result": {
      const ok = obj.status !== "error" && !obj.error;
      return { events, result: { ok, error: ok ? undefined : String(obj.error ?? obj.message ?? "gemini reported an error") } };
    }
    default:
      break;
  }
  return { events };
}

/* ---------------------------------------------------------------------------------------------
 * <cwd>/.gemini/settings.json management.
 *
 * Gemini reads MCP servers and tool exclusions from the project's settings file, so runs must edit
 * it. Edits are serialised per cwd, every run owns its own `agenticview-<runId>` server entry, tool
 * exclusions are the union of all active runs (restrictive on purpose), and the original bytes are
 * restored (or the file removed) when the last run in that cwd finishes.
 * ------------------------------------------------------------------------------------------- */

interface CwdState {
  original: string | undefined;
  dirCreated: boolean;
  chain: Promise<void>;
  entries: Map<string, unknown>;
  excludes: Map<string, string[]>;
}

const cwdStates = new Map<string, CwdState>();

function settingsPath(cwd: string): string {
  return join(cwd, ".gemini", "settings.json");
}

function parse(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function writeMerged(cwd: string, state: CwdState): Promise<void> {
  const base = parse(state.original);
  const servers = { ...((base.mcpServers as Record<string, unknown> | undefined) ?? {}) };
  for (const [runId, entry] of state.entries) servers[`${ENTRY_PREFIX}${runId}`] = entry;
  const merged: Record<string, unknown> = { ...base, mcpServers: servers };
  const exclude = [...new Set([...state.excludes.values()].flat())];
  if (exclude.length > 0) {
    const baseTools = (base.tools as Record<string, unknown> | undefined) ?? {};
    const baseExclude = Array.isArray(baseTools.exclude) ? (baseTools.exclude as string[]) : Array.isArray(base.excludeTools) ? (base.excludeTools as string[]) : [];
    const all = [...new Set([...baseExclude, ...exclude])];
    merged.tools = { ...baseTools, exclude: all };
    merged.excludeTools = all;
    merged[MARKER_KEY] = { managedExcludes: true };
  }
  await writeFile(settingsPath(cwd), JSON.stringify(merged, null, 2), "utf8");
}

function locked<T>(state: CwdState, fn: () => Promise<T>): Promise<T> {
  const run = state.chain.then(fn, fn);
  state.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Register this run's server entry and exclusions; returns a function that removes them again. */
async function installSettings(cwd: string, runId: string, entry: unknown | undefined, exclude: string[]): Promise<() => Promise<void>> {
  let state = cwdStates.get(cwd);
  if (!state) {
    state = { original: undefined, dirCreated: false, chain: Promise.resolve(), entries: new Map(), excludes: new Map() };
    cwdStates.set(cwd, state);
  }
  const s = state;
  await locked(s, async () => {
    if (s.entries.size === 0 && s.excludes.size === 0) {
      try {
        s.original = await readFile(settingsPath(cwd), "utf8");
      } catch {
        s.original = undefined;
      }
      try {
        await mkdir(join(cwd, ".gemini"), { recursive: false });
        s.dirCreated = true;
      } catch {
        s.dirCreated = false;
      }
    }
    if (entry !== undefined) s.entries.set(runId, entry);
    if (exclude.length > 0) s.excludes.set(runId, exclude);
    await writeMerged(cwd, s);
  });
  return async () => {
    await locked(s, async () => {
      s.entries.delete(runId);
      s.excludes.delete(runId);
      if (s.entries.size > 0 || s.excludes.size > 0) {
        await writeMerged(cwd, s);
        return;
      }
      if (s.original !== undefined) await writeFile(settingsPath(cwd), s.original, "utf8");
      else {
        await rm(settingsPath(cwd), { force: true });
        if (s.dirCreated) await rmdir(join(cwd, ".gemini")).catch(() => undefined);
      }
      if (cwdStates.get(cwd) === s) cwdStates.delete(cwd);
    });
  };
}

/** Boot-time repair: strip entries a crashed server left behind in <project>/.gemini/settings.json. */
export async function cleanupGeminiSettings(projectPath: string): Promise<void> {
  const file = settingsPath(projectPath);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  const settings = parse(text);
  let changed = false;
  const servers = settings.mcpServers as Record<string, unknown> | undefined;
  if (servers && typeof servers === "object") {
    for (const k of Object.keys(servers)) {
      if (k.startsWith(ENTRY_PREFIX) || k === "agenticview") {
        delete servers[k];
        changed = true;
      }
    }
  }
  const marker = settings[MARKER_KEY] as { managedExcludes?: boolean } | undefined;
  if (marker?.managedExcludes) {
    delete settings.excludeTools;
    const tools = settings.tools as Record<string, unknown> | undefined;
    if (tools) {
      delete tools.exclude;
      if (Object.keys(tools).length === 0) delete settings.tools;
    }
    delete settings[MARKER_KEY];
    changed = true;
  }
  if (!changed) return;
  const onlyEmptyServers = Object.keys(settings).every((k) => k === "mcpServers" && Object.keys((settings.mcpServers as Record<string, unknown>) ?? {}).length === 0);
  if (Object.keys(settings).length === 0 || onlyEmptyServers) {
    await rm(file, { force: true });
    await rmdir(join(projectPath, ".gemini")).catch(() => undefined);
    return;
  }
  await writeFile(file, JSON.stringify(settings, null, 2), "utf8");
}

export class GeminiRuntime implements Runtime {
  readonly provider = "gemini" as const;
  private readonly spawn: typeof nodeSpawn;
  private readonly which: Which;

  constructor(private readonly opts: GeminiRuntimeOptions) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.which = opts.which ?? defaultWhich;
  }

  async check(): Promise<ProviderStatus> {
    const bin = await this.which(this.opts.bin ?? "gemini");
    if (!bin) return { provider: "gemini", ok: false, reason: GEMINI_MISSING_REASON };
    return { provider: "gemini", ok: true, version: bin };
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    let text = "";
    let sessionId: string | undefined = req.sessionId;
    if (signal.aborted) return { text, stopReason: "aborted" };
    const useBridge = req.bridgeTools.length > 0;
    const exclude = excludedToolsFor(req.tools);
    const serverName = `${ENTRY_PREFIX}${req.runId}`;
    const entry = useBridge
      ? {
          command: process.execPath,
          args: [this.opts.bridgeEntry],
          env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
          trust: true,
        }
      : undefined;
    const restore = useBridge || exclude.length > 0 ? await installSettings(req.cwd, req.runId, entry, exclude) : async () => undefined;
    let child: ChildProcess | undefined;
    const onAbort = () => child?.kill();
    try {
      const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
      const images = req.prompt.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.path : ""));
      const promptText = [req.systemPrompt, ...textParts, images.length ? `Attached images:\n${images.map((i) => `@${i}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
      const viaStdin = promptText.length > MAX_ARG_PROMPT;
      const args = ["-p", viaStdin ? STDIN_MARKER : promptText, "--output-format", "stream-json", "--approval-mode", APPROVAL[req.permissionMode]];
      if (req.model) args.push("-m", req.model);
      if (req.sessionId) args.push("--resume", req.sessionId);
      if (useBridge) args.push("--allowed-mcp-server-names", serverName);
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      if (this.opts.apiKey && !env.GEMINI_API_KEY) env.GEMINI_API_KEY = this.opts.apiKey;

      const binName = this.opts.bin ?? "gemini";
      const resolved = (await this.which(binName)) ?? binName;
      const shimTarget = await resolveNodeShim(resolved);
      const command = shimTarget ? process.execPath : resolved;
      const finalArgs = shimTarget ? [shimTarget, ...args] : args;
      child = this.spawn(command, finalArgs, { cwd: req.cwd, env, stdio: [viaStdin ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true });
      if (viaStdin) child.stdin?.end(promptText);
      signal.addEventListener("abort", onAbort, { once: true });
      const stderr: string[] = [];
      child.stderr?.on("data", (d) => {
        for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderr.push(l);
        if (stderr.length > 200) stderr.splice(0, stderr.length - 200);
      });
      let final: { ok: boolean; error?: string } | undefined;
      const rl = createInterface({ input: child.stdout! });
      const exit = new Promise<number | null>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("exit", (code) => resolve(code));
      });
      for await (const line of rl) {
        const m = mapGeminiLine(line);
        if (m.sessionId) sessionId = m.sessionId;
        if (m.result) final = m.result;
        for (const ev of m.events) {
          if (ev.type === "text") text += ev.text;
          sink(ev);
        }
      }
      const code = await exit;
      if (signal.aborted) return { text, stopReason: "aborted", sessionId };
      if (code === 53) return { text, stopReason: "max_turns", error: "turn limit exceeded", sessionId };
      if (code !== 0) return { text, stopReason: "error", error: `gemini exited with ${code}: ${stderr.slice(-20).join("\n")}`, sessionId };
      if (final && !final.ok) return { text, stopReason: "error", error: final.error, sessionId };
      return { text, stopReason: "done", sessionId };
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted", sessionId };
      return { text, stopReason: "error", error: (e as Error).message, sessionId };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await restore();
    }
  }
}
