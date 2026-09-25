import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { Effort, PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { which as defaultWhich, type Which } from "./which.js";

/**
 * Google Antigravity CLI (`agy`) runtime.
 *
 * Runs `agy -p <prompt> --output-format stream-json` headless on the user's Antigravity sign-in
 * (no API key). Everything below was verified against agy 1.2.11.
 *
 * Per-run workspace plugin. agy only has a *global* MCP config (~/.gemini/config/mcp_config.json),
 * but it also loads every `<cwd>/.agents/plugins/<name>/` that holds a `plugin.json`, starting the
 * MCP servers in its `mcp_config.json` and the hooks in its `hooks.json`. Each run that needs it
 * writes `agenticview-<runId>` there and deletes it afterwards (plus agy's schema cache for the
 * server under ~/.gemini/antigravity-cli/mcp/), so the global config is never touched.
 *
 * Permissions. Headless agy denies anything that would need approval: default mode and
 * `--mode accept-edits` allow workspace edits but deny shell commands *and MCP tool calls*; hooks
 * returning "allow" cannot lift that. Only `--dangerously-skip-permissions` lets bridge tools run.
 * PreToolUse hooks returning "deny" *are* honoured in every mode, and a hook that fails blocks the
 * tool. So a run with bridge tools uses skip-permissions and enforces the agent's limits with
 * deny hooks; a run without bridge tools uses the native mode (default / accept-edits / skip) and
 * the same deny hooks on top.
 */

export interface AntigravityRuntimeOptions {
  bin?: string;
  bridgeEntry: string;
  bridgeUrl: () => string;
  spawn?: typeof nodeSpawn;
  which?: Which;
  /** Override the platform (tests). */
  platform?: NodeJS.Platform;
  /** Override environment lookups such as LOCALAPPDATA (tests). */
  env?: NodeJS.ProcessEnv;
  /** Home directory holding `.gemini/antigravity-cli` (tests). */
  home?: string;
}

export const ANTIGRAVITY_MISSING_REASON = "Install the Antigravity CLI (agy) and sign in by running `agy` once.";

const PLUGIN_PREFIX = "agenticview-";
const SERVER_NAME = "agenticview";
const PLUGIN_MARKER = "agenticview-managed";
/** Prompts longer than this are written to a file; Windows limits a command line to 32 K characters. */
const MAX_ARG_PROMPT = 30_000;
const AGY_EFFORTS: ReadonlySet<Effort> = new Set(["low", "medium", "high", "max"]);

const CREATE_TOOLS = new Set(["write_to_file"]);
const MODIFY_TOOLS = new Set(["replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);

/* ------------------------------------------------------------------------------------------ */
/* Arguments                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface AgyArgsInput {
  prompt: string;
  model?: string;
  effort?: Effort;
  sessionId?: string;
  permissionMode: PermissionMode;
  tools: ToolAllowance;
  /** Whether the run exposes bridge tools over MCP (forces skip-permissions, see above). */
  bridge?: boolean;
}

export const AGY_EDIT_TOOLS = ["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"] as const;
export const AGY_SHELL_TOOLS = ["run_command", "send_command_input", "notebook_execution"] as const;
export const AGY_WEB_TOOLS = [
  "search_web",
  "read_url_content",
  "open_browser_url",
  "read_browser_page",
  "list_browser_pages",
  "browser_subagent",
  "browser_click_element",
  "browser_drag_pixel_to_pixel",
  "browser_get_dom",
  "browser_get_network_request",
  "browser_input",
  "browser_list_network_requests",
  "browser_mouse_down",
  "browser_mouse_up",
  "browser_move_mouse",
  "browser_press_key",
  "browser_refresh_page",
  "browser_resize_window",
  "browser_scroll",
  "browser_scroll_dom",
  "browser_select_option",
  "capture_browser_console_logs",
  "capture_browser_screenshot",
  "click_browser_pixel",
  "execute_browser_javascript",
] as const;

/**
 * What an agent may do on agy: `ask` cannot prompt headless, so like Codex it is read-only;
 * `auto-edit` edits without asking but runs no commands; `auto` does everything its allowances permit.
 */
export function effectiveAllowance(mode: PermissionMode, tools: ToolAllowance): { edit: boolean; shell: boolean; web: boolean } {
  if (mode === "ask") return { edit: false, shell: false, web: tools.web };
  if (mode === "auto-edit") return { edit: tools.edit, shell: false, web: tools.web };
  return { edit: tools.edit, shell: tools.shell, web: tools.web };
}

/** agy tool names a run must block with deny hooks. */
export function deniedTools(mode: PermissionMode, tools: ToolAllowance): string[] {
  const a = effectiveAllowance(mode, tools);
  return [...(a.edit ? [] : AGY_EDIT_TOOLS), ...(a.shell ? [] : AGY_SHELL_TOOLS), ...(a.web ? [] : AGY_WEB_TOOLS)];
}

/** Permission flags: skip-permissions when bridge tools must work or the mode is `auto`, else agy's native mode. */
export function modeArgs(mode: PermissionMode, bridge = false): string[] {
  if (bridge || mode === "auto") return ["--dangerously-skip-permissions"];
  if (mode === "auto-edit") return ["--mode", "accept-edits"];
  return [];
}

export function buildAgyArgs(input: AgyArgsInput): string[] {
  const args = ["-p", input.prompt, "--output-format", "stream-json", "--disable-slash-commands"];
  if (input.model) args.push("--model", input.model);
  if (input.effort && AGY_EFFORTS.has(input.effort)) args.push("--effort", input.effort);
  if (input.sessionId) args.push("--conversation", input.sessionId);
  args.push(...modeArgs(input.permissionMode, input.bridge));
  return args;
}

/** Tells the model up front which tool groups are blocked, so it does not waste turns on them. */
export function allowanceNotes(mode: PermissionMode, tools: ToolAllowance): string[] {
  const a = effectiveAllowance(mode, tools);
  const out: string[] = [];
  if (!a.edit) out.push("You may not create, edit or delete files: file-writing tools are blocked.");
  if (!a.shell) out.push("You may not run shell commands: command tools are blocked.");
  if (!a.web) out.push("You may not search the web, fetch URLs or use the browser: those tools are blocked.");
  return out;
}


/* ------------------------------------------------------------------------------------------ */
/* Event mapping                                                                               */
/* ------------------------------------------------------------------------------------------ */

export interface AgyMapState {
  /** step_index -> buffered text deltas of an agent_response step. */
  text: Map<number, string>;
  /** step indexes whose tool_start was already emitted. */
  started: Set<number>;
}

export function newAgyMapState(): AgyMapState {
  return { text: new Map(), started: new Set() };
}

export interface AgyLineResult {
  events: RunEvent[];
  sessionId?: string;
  result?: { ok: boolean; error?: string; response?: string; usage?: { inputTokens: number; outputTokens: number } };
}

interface ToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: unknown;
  error?: { type?: string; message?: string };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function toolName(info: ToolInfo, fallback: string): string {
  if ((info.name ?? fallback) === "call_mcp_tool") return str(info.parameters?.ToolName) ?? "call_mcp_tool";
  return info.name ?? fallback;
}

function toolInput(info: ToolInfo): unknown {
  if (info.name === "call_mcp_tool") return info.parameters?.Arguments ?? {};
  return info.parameters ?? {};
}

function filePathOf(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  return str(params.TargetFile) ?? str(params.AbsolutePath) ?? str(params.FilePath) ?? str(params.path);
}

function flush(state: AgyMapState, index: number, events: RunEvent[]): void {
  const t = state.text.get(index);
  state.text.delete(index);
  if (t && t.trim()) events.push({ type: "text", text: t });
}

/** Flush all buffered text (end of stream). */
export function flushAgyText(state: AgyMapState): RunEvent[] {
  const events: RunEvent[] = [];
  for (const i of [...state.text.keys()].sort((a, b) => a - b)) flush(state, i, events);
  return events;
}

/**
 * Pure mapping from one agy stream-json line to RunEvents. agent_response text arrives as small
 * `text_delta` chunks; they are buffered per step and emitted as one text event when the step is
 * DONE (or when another step starts), so the office feed gets whole messages.
 */
export function mapAgyLine(line: string, state: AgyMapState): AgyLineResult {
  const events: RunEvent[] = [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return { events: line.trim() ? [{ type: "status", text: line.trim().slice(0, 200) }] : [] };
  }
  if (!obj || typeof obj !== "object") return { events };
  switch (obj.event) {
    case "init":
      return { events, sessionId: str(obj.conversation_id) || undefined };
    case "step_update": {
      const s = (obj.step_update ?? {}) as Record<string, unknown>;
      const index = typeof s.step_index === "number" ? s.step_index : -1;
      // DONE, ERROR (a failed or denied tool), CANCELED, ...: anything but ACTIVE ends the step.
      const done = typeof s.state === "string" && s.state !== "ACTIVE";
      // A new step means earlier text steps are finished.
      for (const k of [...state.text.keys()]) if (k !== index) flush(state, k, events);
      if (s.step_type === "agent_response") {
        const delta = str(s.text_delta);
        if (delta) state.text.set(index, (state.text.get(index) ?? "") + delta);
        if (done) flush(state, index, events);
        break;
      }
      if (s.step_type === "tool") {
        const info = (s.tool_info ?? {}) as ToolInfo;
        const raw = info.name ?? str(s.tool_name) ?? "tool";
        const name = toolName({ ...info, name: raw }, raw);
        if (!state.started.has(index)) {
          state.started.add(index);
          events.push({ type: "tool_start", name, input: toolInput({ ...info, name: raw }) });
        }
        if (done) {
          const ok = !info.error && s.state !== "ERROR";
          const summary = ok ? (typeof info.output === "string" ? info.output : info.output === undefined ? "" : JSON.stringify(info.output)) : (info.error?.message ?? "tool failed");
          events.push({ type: "tool_end", name, ok, summary: summary.trim().slice(0, 200) });
          const path = filePathOf(info.parameters);
          if (ok && path) {
            if (CREATE_TOOLS.has(raw)) events.push({ type: "file_changed", path, kind: "create" });
            else if (MODIFY_TOOLS.has(raw)) events.push({ type: "file_changed", path, kind: "modify" });
          }
        }
        break;
      }
      break;
    }
    case "error":
      events.push({ type: "status", text: `error: ${String(obj.message ?? obj.error ?? "unknown")}` });
      break;
    case "result": {
      events.push(...flushAgyText(state));
      const r = (obj.result ?? {}) as Record<string, unknown>;
      const ok = r.status === "SUCCESS";
      const denied = Array.isArray(r.denied_actions) ? (r.denied_actions as Array<Record<string, unknown>>) : [];
      if (denied.length > 0) events.push({ type: "status", text: `denied: ${denied.map((d) => str(d.display_name) ?? str(d.action) ?? "action").join(", ")}` });
      const u = (r.usage ?? {}) as Record<string, unknown>;
      const usage = typeof u.input_tokens === "number" ? { inputTokens: u.input_tokens, outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : 0 } : undefined;
      return {
        events,
        sessionId: str(r.conversation_id) || undefined,
        result: { ok, error: ok ? undefined : str(r.error) || `agy reported ${String(r.status ?? "an error")}`, response: str(r.response), usage },
      };
    }
    default:
      break;
  }
  return { events };
}

/* ------------------------------------------------------------------------------------------ */
/* Bridge plugin                                                                               */
/* ------------------------------------------------------------------------------------------ */

export function pluginName(runId: string): string {
  return `${PLUGIN_PREFIX}${runId}`;
}

/** The MCP server name agy shows for the bridge (`<plugin>_<server>`). */
export function bridgeServerName(runId: string): string {
  return `${pluginName(runId)}_${SERVER_NAME}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface RunPluginSpec {
  /** Bridge MCP server; omitted when the run has no bridge tools. */
  server?: { command: string; args: string[]; env: Record<string, string> };
  /** agy tool names to block with PreToolUse deny hooks. */
  deny: readonly string[];
}

const DENY_JSON = JSON.stringify({ decision: "deny", reason: "AgenticView: this agent is not allowed to use this tool." });

/**
 * The shell command agy runs for a deny hook. agy runs hook commands through `cmd /c` on Windows and
 * escapes any `"` in them, which breaks both quoted paths and inline JSON; so on Windows the JSON
 * lives in `deny.cmd` and the command is quote-free (`cd /d` takes paths with spaces unquoted, and
 * the `.\` prefix is needed because agy's environment stops cmd searching the current directory).
 * If the command ever fails, agy blocks the tool anyway.
 */
export function denyHookCommand(dir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `cd /d ${dir} && .\\deny.cmd`;
  return `printf '%s\\n' '${DENY_JSON}'`;
}

export function hooksConfig(dir: string, deny: readonly string[], platform: NodeJS.Platform = process.platform): Record<string, unknown> {
  const command = denyHookCommand(dir, platform);
  return { "agenticview-guard": { PreToolUse: deny.map((matcher) => ({ matcher, hooks: [{ command }] })) } };
}

/**
 * Write `<cwd>/.agents/plugins/agenticview-<runId>/` (plugin.json, plus mcp_config.json for the
 * bridge and hooks.json + deny.cmd for blocked tools). Returns a function that removes it again,
 * plus `.agents/plugins` and `.agents` when this run created them and they are empty, plus agy's
 * tool-schema cache for the server.
 */
export async function installRunPlugin(cwd: string, runId: string, spec: RunPluginSpec, home: string = homedir(), platform: NodeJS.Platform = process.platform): Promise<() => Promise<void>> {
  const agentsDir = join(cwd, ".agents");
  const pluginsDir = join(agentsDir, "plugins");
  const dir = join(pluginsDir, pluginName(runId));
  const createdAgents = !(await exists(agentsDir));
  const createdPlugins = !(await exists(pluginsDir));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "plugin.json"), JSON.stringify({ name: pluginName(runId), description: "AgenticView tools and limits for one run (removed when the run ends).", [PLUGIN_MARKER]: true }, null, 2), "utf8");
  if (spec.server) await writeFile(join(dir, "mcp_config.json"), JSON.stringify({ mcpServers: { [SERVER_NAME]: spec.server } }, null, 2), "utf8");
  if (spec.deny.length > 0) {
    if (platform === "win32") await writeFile(join(dir, "deny.cmd"), `@echo ${DENY_JSON}\r\n`, "utf8");
    await writeFile(join(dir, "hooks.json"), JSON.stringify(hooksConfig(dir, spec.deny, platform), null, 2), "utf8");
  }
  return async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    if (createdPlugins) await rmdir(pluginsDir).catch(() => undefined);
    if (createdAgents) await rmdir(agentsDir).catch(() => undefined);
    await rm(join(home, ".gemini", "antigravity-cli", "mcp", bridgeServerName(runId)), { recursive: true, force: true }).catch(() => undefined);
  };
}

/**
 * Boot-time repair: remove bridge plugins a crashed server left in `<project>/.agents/plugins`, and
 * agy schema caches for AgenticView servers older than a day (other projects may still be running).
 */
export async function cleanupAntigravityPlugins(projectPath: string, home: string = homedir()): Promise<void> {
  const pluginsDir = join(projectPath, ".agents", "plugins");
  let names: string[] = [];
  try {
    names = await readdir(pluginsDir);
  } catch {
    names = [];
  }
  let removed = false;
  for (const n of names) {
    if (!n.startsWith(PLUGIN_PREFIX)) continue;
    try {
      const manifest = JSON.parse(await readFile(join(pluginsDir, n, "plugin.json"), "utf8")) as Record<string, unknown>;
      if (manifest[PLUGIN_MARKER] !== true) continue;
    } catch {
      continue;
    }
    await rm(join(pluginsDir, n), { recursive: true, force: true }).catch(() => undefined);
    removed = true;
  }
  if (removed) {
    await rmdir(pluginsDir).catch(() => undefined);
    await rmdir(join(projectPath, ".agents")).catch(() => undefined);
  }
  const cache = join(home, ".gemini", "antigravity-cli", "mcp");
  let cached: string[] = [];
  try {
    cached = await readdir(cache);
  } catch {
    return;
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const n of cached) {
    if (!n.startsWith(PLUGIN_PREFIX) || !n.endsWith(`_${SERVER_NAME}`)) continue;
    try {
      if ((await stat(join(cache, n))).mtimeMs < cutoff) await rm(join(cache, n), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Runtime                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Kill a process and its children. On Windows `child.kill()` leaves agy's helpers running. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, spawn: typeof nodeSpawn = nodeSpawn): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (platform === "win32") {
    try {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => child.kill());
      return;
    } catch {
      /* fall through */
    }
  }
  child.kill();
}

export class AntigravityRuntime implements Runtime {
  readonly provider = "antigravity" as const;
  private readonly spawn: typeof nodeSpawn;
  private readonly which: Which;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;

  constructor(private readonly opts: AntigravityRuntimeOptions) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.which = opts.which ?? defaultWhich;
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
    this.home = opts.home ?? homedir();
  }

  /** agy on PATH, else the default Windows install location (%LOCALAPPDATA%\agy\bin\agy.exe). */
  async locate(): Promise<string | undefined> {
    const onPath = await this.which(this.opts.bin ?? "agy");
    if (onPath) return onPath;
    const local = this.env.LOCALAPPDATA;
    if (this.platform === "win32" && local) {
      const exe = join(local, "agy", "bin", "agy.exe");
      if (await exists(exe)) return exe;
    }
    return undefined;
  }

  private version(bin: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let out = "";
      let child: ChildProcess;
      try {
        child = this.spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      } catch {
        resolve(undefined);
        return;
      }
      const timer = setTimeout(() => {
        child.kill();
        resolve(undefined);
      }, 10_000);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.once("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const v = out.trim().split(/\r?\n/)[0];
        resolve(code === 0 && v ? v : undefined);
      });
    });
  }

  async check(): Promise<ProviderStatus> {
    const bin = await this.locate();
    if (!bin) return { provider: "antigravity", ok: false, reason: ANTIGRAVITY_MISSING_REASON };
    const v = await this.version(bin);
    return { provider: "antigravity", ok: true, version: v ? `agy ${v} (${bin})` : bin };
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    let text = "";
    let sessionId: string | undefined = req.sessionId;
    if (signal.aborted) return { text, stopReason: "aborted" };
    const useBridge = req.bridgeTools.length > 0;
    let restore: () => Promise<void> = async () => undefined;
    let promptFile: string | undefined;
    let child: ChildProcess | undefined;
    const onAbort = () => {
      if (child) killTree(child, this.platform, this.spawn);
    };
    try {
      const deny = deniedTools(req.permissionMode, req.tools);
      if (useBridge || deny.length > 0) {
        const server = useBridge
          ? {
              command: process.execPath,
              args: [this.opts.bridgeEntry],
              env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
            }
          : undefined;
        restore = await installRunPlugin(req.cwd, req.runId, { server, deny }, this.home, this.platform);
      }
      const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
      const images = req.prompt.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.path : ""));
      const notes = allowanceNotes(req.permissionMode, req.tools);
      const bridgeNote = useBridge
        ? `Your AgenticView tools (${req.bridgeTools.map((t) => t.name).join(", ")}) are on the MCP server "${bridgeServerName(req.runId)}". Call them with call_mcp_tool; do not use MCP servers named agenticview-* other than that one.`
        : "";
      let promptText = [
        req.systemPrompt,
        notes.length ? notes.join(" ") : "",
        bridgeNote,
        ...textParts,
        images.length ? `Attached images (view these files):\n${images.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      if (promptText.length > MAX_ARG_PROMPT) {
        promptFile = join(tmpdir(), `agenticview-prompt-${req.runId}.md`);
        await writeFile(promptFile, promptText, "utf8");
        promptText = `The full task is in the file ${promptFile}. Read that whole file first with view_file, then follow it exactly.`;
      }
      const args = buildAgyArgs({ prompt: promptText, model: req.model, effort: req.effort, sessionId: req.sessionId, permissionMode: req.permissionMode, tools: req.tools, bridge: useBridge });
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;

      const bin = (await this.locate()) ?? this.opts.bin ?? "agy";
      child = this.spawn(bin, args, { cwd: req.cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      signal.addEventListener("abort", onAbort, { once: true });
      const stderr: string[] = [];
      child.stderr?.on("data", (d) => {
        for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderr.push(l);
        if (stderr.length > 200) stderr.splice(0, stderr.length - 200);
      });
      const exit = new Promise<number | null>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("close", (code) => resolve(code));
      });
      const state = newAgyMapState();
      let final: AgyLineResult["result"];
      const emit = (ev: RunEvent) => {
        if (ev.type === "text") text += (text ? "\n\n" : "") + ev.text;
        sink(ev);
      };
      const rl = createInterface({ input: child.stdout! });
      for await (const line of rl) {
        const m = mapAgyLine(line, state);
        if (m.sessionId) sessionId = m.sessionId;
        if (m.result) final = m.result;
        m.events.forEach(emit);
      }
      flushAgyText(state).forEach(emit);
      const code = await exit;
      if (signal.aborted) return { text, stopReason: "aborted", sessionId };
      if (!text && final?.response) text = final.response;
      if (final && !final.ok) return { text, stopReason: "error", error: final.error, sessionId, usage: final.usage };
      if (code !== 0) return { text, stopReason: "error", error: `agy exited with ${code}: ${stderr.slice(-20).join("\n")}`, sessionId, usage: final?.usage };
      if (!final) return { text, stopReason: "error", error: `agy ended without a result${stderr.length ? `: ${stderr.slice(-20).join("\n")}` : ""}`, sessionId };
      return { text, stopReason: "done", sessionId, usage: final.usage };
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted", sessionId };
      return { text, stopReason: "error", error: (e as Error).message, sessionId };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await restore();
      if (promptFile) await rm(promptFile, { force: true }).catch(() => undefined);
    }
  }
}
