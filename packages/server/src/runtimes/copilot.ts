import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { Effort, PermissionMode, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { which as defaultWhich, type Which } from "./which.js";
import { extractCliError } from "./errors.js";
import { resolveNodeShim } from "./gemini.js";
import { killTree } from "./antigravity.js";

/**
 * GitHub Copilot CLI (`copilot`) runtime.
 *
 * Runs `copilot -p <prompt> --output-format json` headless on the user's Copilot sign-in (no API
 * key; usage comes out of their Copilot plan). Everything below was verified against CLI 1.0.88.
 *
 * Output is JSONL: `{type, data, ephemeral?, id, timestamp}` session events, ending with
 * `{type:"result", sessionId, exitCode, usage}`. The events used here:
 * - `session.auto_mode_resolved` {chosenModel}: the model `--model auto` routed to.
 * - `assistant.message` {content, model, toolRequests}: one whole assistant message per turn (the
 *   `assistant.message_delta` stream is ignored, so the feed gets whole messages).
 * - `tool.execution_start` {toolCallId, toolName, arguments, mcpServerName?, mcpToolName?} and
 *   `tool.execution_complete` {toolCallId, success, result:{content}, error:{message, code}}. A tool
 *   blocked by a permission rule completes with success=false and error.code "denied".
 * - `session.error` / `error`: surfaced as status lines.
 * Token counts are not in the stream; `--usage-output-file` writes them (cumulative per session).
 *
 * Bridge tools. `--additional-mcp-config @<file>` adds MCP servers for one session only, so each
 * run writes `agenticview-<runId>` into a private temp dir and deletes it afterwards; the user's
 * ~/.copilot/mcp-config.json (what `copilot mcp add` edits) is never touched. Stale temp dirs from
 * a crashed server are swept at startup.
 *
 * Permissions. `--allow-all-tools` is required headless (otherwise anything needing approval is
 * denied, yet read-only shell commands still run), and `--deny-tool` rules beat it. So every run
 * allows all tools and denies what the agent may not do: `write` (file-writing tools, incl.
 * apply_patch), `shell` and `url`. auto-edit therefore maps to "edits yes, shell no" natively.
 */

export interface CopilotRuntimeOptions {
  bin?: string;
  bridgeEntry: string;
  bridgeUrl: () => string;
  spawn?: typeof nodeSpawn;
  which?: Which;
  platform?: NodeJS.Platform;
  /** Directory for per-run temp dirs (tests). */
  tmpDir?: string;
}

export const COPILOT_MISSING_REASON = "Install the GitHub Copilot CLI (npm i -g @github/copilot) and sign in with `copilot login`.";

const TEMP_PREFIX = "agenticview-copilot-";
const SERVER_PREFIX = "agenticview-";
/** Prompts longer than this are written to a file; Windows limits a command line to 32 K characters. */
const MAX_ARG_PROMPT = 30_000;
const EFFORT_REJECTED = /does not support reasoning effort/i;

/* ------------------------------------------------------------------------------------------ */
/* Arguments                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * What an agent may do: `ask` cannot prompt headless, so (like Codex and Antigravity) it is read-only;
 * `auto-edit` edits without asking but runs no commands; `auto` does everything its allowances permit.
 */
export function effectiveAllowance(mode: PermissionMode, tools: ToolAllowance): { edit: boolean; shell: boolean; web: boolean } {
  if (mode === "ask") return { edit: false, shell: false, web: tools.web };
  if (mode === "auto-edit") return { edit: tools.edit, shell: false, web: tools.web };
  return { edit: tools.edit, shell: tools.shell, web: tools.web };
}

/** `--deny-tool` rules for what the agent may not do (they take precedence over --allow-all-tools). */
export function denyRules(mode: PermissionMode, tools: ToolAllowance): string[] {
  const a = effectiveAllowance(mode, tools);
  return [...(a.edit ? [] : ["write"]), ...(a.shell ? [] : ["shell"]), ...(a.web ? [] : ["url"])];
}

export interface CopilotArgsInput {
  prompt: string;
  model?: string;
  effort?: Effort;
  sessionId?: string;
  permissionMode: PermissionMode;
  tools: ToolAllowance;
  /** Path of the per-run MCP config (bridge tools). */
  mcpConfig?: string;
  usageFile?: string;
  attachments?: string[];
}

export function buildCopilotArgs(input: CopilotArgsInput): string[] {
  const args = ["-p", input.prompt, "--output-format", "json", "--no-ask-user", "--allow-all-tools"];
  for (const rule of denyRules(input.permissionMode, input.tools)) args.push("--deny-tool", rule);
  // The built-in GitHub MCP server can act on GitHub (issues, PRs); keep it to fully trusted agents.
  const a = effectiveAllowance(input.permissionMode, input.tools);
  if (!(input.permissionMode === "auto" && a.edit && a.shell && a.web)) args.push("--disable-builtin-mcps");
  if (input.model) args.push("--model", input.model);
  // `--model auto` (and no model, which usually means auto) rejects any reasoning effort.
  if (input.effort && input.model && input.model !== "auto") args.push("--reasoning-effort", input.effort);
  if (input.sessionId) args.push("--resume", input.sessionId);
  if (input.mcpConfig) args.push("--additional-mcp-config", `@${input.mcpConfig}`);
  if (input.usageFile) args.push("--usage-output-file", input.usageFile);
  for (const f of input.attachments ?? []) args.push("--attachment", f);
  return args;
}

/** Tells the model up front which tool groups are blocked, so it does not waste turns on them. */
export function allowanceNotes(mode: PermissionMode, tools: ToolAllowance): string[] {
  const a = effectiveAllowance(mode, tools);
  const out: string[] = [];
  if (!a.edit) out.push("You may not create, edit or delete files: file-writing tools are blocked.");
  if (!a.shell) out.push("You may not run shell commands: command tools are blocked.");
  if (!a.web) out.push("You may not fetch URLs or browse the web: URL access is blocked.");
  return out;
}

export function serverName(runId: string): string {
  return `${SERVER_PREFIX}${runId}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Event mapping                                                                               */
/* ------------------------------------------------------------------------------------------ */

export interface CopilotMapState {
  /** toolCallId -> display name and raw tool name/arguments of tools started but not finished. */
  tools: Map<string, { name: string; raw: string; args: unknown }>;
  /** Model already announced as a status line. */
  model?: string;
  denied: string[];
  cwd?: string;
}

export function newCopilotMapState(cwd?: string): CopilotMapState {
  return { tools: new Map(), denied: [], cwd };
}

export interface CopilotLineResult {
  events: RunEvent[];
  sessionId?: string;
  result?: { exitCode: number };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Files an apply_patch patch touches, from its `*** Add/Update/Delete File:` and `*** Move to:` headers. */
export function patchFiles(patch: string): Array<{ path: string; kind: "create" | "modify" | "delete" }> {
  const out: Array<{ path: string; kind: "create" | "modify" | "delete" }> = [];
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/.exec(line);
    if (m) out.push({ path: m[2]!, kind: m[1] === "Add" ? "create" : m[1] === "Delete" ? "delete" : "modify" });
    const mv = /^\*\*\* Move to:\s*(.+?)\s*$/.exec(line);
    if (mv) out.push({ path: mv[1]!, kind: "create" });
  }
  return out;
}

/** Editor-style write tools some Copilot models use instead of apply_patch. */
const CREATE_TOOLS = new Set(["create", "write_file", "create_file"]);
const MODIFY_TOOLS = new Set(["edit", "str_replace", "str_replace_editor", "edit_file", "insert"]);

function changedFiles(raw: string, args: unknown): Array<{ path: string; kind: "create" | "modify" | "delete" }> {
  if (raw === "apply_patch") {
    const patch = typeof args === "string" ? args : str((args as Record<string, unknown> | undefined)?.input) ?? str((args as Record<string, unknown> | undefined)?.patch);
    return patch ? patchFiles(patch) : [];
  }
  const a = (args ?? {}) as Record<string, unknown>;
  const path = str(a.path) ?? str(a.file_path) ?? str(a.filePath);
  if (!path) return [];
  if (CREATE_TOOLS.has(raw)) return [{ path, kind: "create" }];
  if (MODIFY_TOOLS.has(raw)) return [{ path, kind: str(a.command) === "create" ? "create" : "modify" }];
  return [];
}

function toolInput(args: unknown): unknown {
  return typeof args === "string" ? { input: args } : (args ?? {});
}

function resultText(r: unknown): string {
  if (typeof r === "string") return r;
  const o = (r ?? {}) as Record<string, unknown>;
  return str(o.content) ?? str(o.detailedContent) ?? (r === undefined ? "" : JSON.stringify(r));
}

/** Pure mapping from one Copilot JSONL line to RunEvents. */
export function mapCopilotLine(line: string, state: CopilotMapState): CopilotLineResult {
  const events: RunEvent[] = [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return { events: line.trim() ? [{ type: "status", text: line.trim().slice(0, 200) }] : [] };
  }
  if (!obj || typeof obj !== "object") return { events };
  const data = (obj.data ?? {}) as Record<string, unknown>;
  const announce = (model: string | undefined, text: string) => {
    if (!model || state.model) return;
    state.model = model;
    events.push({ type: "status", text });
  };
  switch (obj.type) {
    case "session.auto_mode_resolved": {
      const m = str(data.chosenModel);
      announce(m, `model: auto -> ${m}`);
      break;
    }
    case "assistant.message": {
      announce(str(data.model), `model: ${str(data.model)}`);
      const t = str(data.content);
      if (t && t.trim()) events.push({ type: "text", text: t });
      break;
    }
    case "tool.execution_start": {
      const id = str(data.toolCallId) ?? "";
      const raw = str(data.toolName) ?? "tool";
      const name = str(data.mcpToolName) ?? raw;
      state.tools.set(id, { name, raw, args: data.arguments });
      events.push({ type: "tool_start", name, input: toolInput(data.arguments) });
      break;
    }
    case "tool.execution_complete": {
      const id = str(data.toolCallId) ?? "";
      const t = state.tools.get(id) ?? { name: "tool", raw: "tool", args: undefined };
      state.tools.delete(id);
      const ok = data.success === true;
      const err = (data.error ?? {}) as Record<string, unknown>;
      const summary = ok ? resultText(data.result) : (str(err.message) ?? "tool failed");
      events.push({ type: "tool_end", name: t.name, ok, summary: summary.trim().slice(0, 200) });
      if (!ok && err.code === "denied") state.denied.push(t.name);
      if (ok) {
        for (const f of changedFiles(t.raw, t.args)) {
          const path = state.cwd && !isAbsolute(f.path) ? resolvePath(state.cwd, f.path) : f.path;
          events.push({ type: "file_changed", path, kind: f.kind });
        }
      }
      break;
    }
    case "session.error":
    case "error": {
      const msg = str(data.message) ?? str(obj.message) ?? str(data.error) ?? "unknown";
      events.push({ type: "status", text: `error: ${msg}` });
      break;
    }
    case "result": {
      if (state.denied.length > 0) events.push({ type: "status", text: `denied: ${[...new Set(state.denied)].join(", ")}` });
      return { events, sessionId: str(obj.sessionId) || undefined, result: { exitCode: typeof obj.exitCode === "number" ? obj.exitCode : 0 } };
    }
    default:
      break;
  }
  return { events };
}

/* ------------------------------------------------------------------------------------------ */
/* Usage                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface Tokens {
  inputTokens: number;
  outputTokens: number;
}

/** Session totals from a `--usage-output-file` report (sum over models). */
export function usageTotals(report: unknown): Tokens | undefined {
  const metrics = ((report ?? {}) as Record<string, unknown>).modelMetrics as Record<string, { usage?: Record<string, unknown> }> | undefined;
  if (!metrics || typeof metrics !== "object") return undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of Object.values(metrics)) {
    const u = m?.usage ?? {};
    if (typeof u.inputTokens === "number") inputTokens += u.inputTokens;
    if (typeof u.outputTokens === "number") outputTokens += u.outputTokens;
  }
  return { inputTokens, outputTokens };
}

/**
 * The report is cumulative for the whole session, so a resumed run's usage is the difference from
 * the totals seen after the session's previous run. A resumed session whose earlier totals are
 * unknown (server restarted) reports no usage rather than double counting.
 */
export class SessionUsage {
  private readonly totals = new Map<string, Tokens>();

  delta(sessionId: string | undefined, resumed: boolean, totals: Tokens | undefined): Tokens | undefined {
    if (!totals) return undefined;
    const prev = sessionId ? this.totals.get(sessionId) : undefined;
    if (sessionId) {
      this.totals.set(sessionId, totals);
      if (this.totals.size > 500) this.totals.delete(this.totals.keys().next().value!);
    }
    if (!resumed) return totals;
    if (!prev) return undefined;
    return { inputTokens: Math.max(0, totals.inputTokens - prev.inputTokens), outputTokens: Math.max(0, totals.outputTokens - prev.outputTokens) };
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Temp files                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Boot-time repair: remove per-run temp dirs (MCP config with a bridge token, prompt, usage) older than a day. */
export async function cleanupCopilotTemp(dir: string = tmpdir(), now: number = Date.now()): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const n of names) {
    if (!n.startsWith(TEMP_PREFIX)) continue;
    try {
      if ((await stat(join(dir, n))).mtimeMs < cutoff) await rm(join(dir, n), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Runtime                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export class CopilotRuntime implements Runtime {
  readonly provider = "copilot" as const;
  private readonly spawn: typeof nodeSpawn;
  private readonly which: Which;
  private readonly platform: NodeJS.Platform;
  private readonly usage = new SessionUsage();

  constructor(private readonly opts: CopilotRuntimeOptions) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.which = opts.which ?? defaultWhich;
    this.platform = opts.platform ?? process.platform;
  }

  /** The command to spawn: npm's Windows `.cmd` shim is unwrapped to `node <script>`. */
  private async command(): Promise<{ command: string; prefix: string[]; bin?: string }> {
    const bin = await this.which(this.opts.bin ?? "copilot");
    const resolved = bin ?? this.opts.bin ?? "copilot";
    const shim = await resolveNodeShim(resolved);
    return shim ? { command: process.execPath, prefix: [shim], bin } : { command: resolved, prefix: [], bin };
  }

  private version(command: string, prefix: string[]): Promise<string | undefined> {
    return new Promise((resolve) => {
      let out = "";
      let child: ChildProcess;
      try {
        child = this.spawn(command, [...prefix, "--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      } catch {
        resolve(undefined);
        return;
      }
      const timer = setTimeout(() => {
        killTree(child, this.platform, this.spawn);
        resolve(undefined);
      }, 15_000);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.once("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const m = /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(out);
        resolve(code === 0 && m ? m[1] : undefined);
      });
    });
  }

  async check(): Promise<ProviderStatus> {
    const { command, prefix, bin } = await this.command();
    if (!bin) return { provider: "copilot", ok: false, reason: COPILOT_MISSING_REASON };
    const v = await this.version(command, prefix);
    return { provider: "copilot", ok: true, version: v ? `copilot ${v} (${bin})` : bin };
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    if (signal.aborted) return { text: "", stopReason: "aborted" };
    const dir = join(this.opts.tmpDir ?? tmpdir(), `${TEMP_PREFIX}${req.runId}`);
    try {
      await mkdir(dir, { recursive: true });
      const useBridge = req.bridgeTools.length > 0;
      let mcpConfig: string | undefined;
      if (useBridge) {
        mcpConfig = join(dir, "mcp-config.json");
        const server = {
          type: "local",
          command: process.execPath,
          args: [this.opts.bridgeEntry],
          env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
          tools: ["*"],
        };
        await writeFile(mcpConfig, JSON.stringify({ mcpServers: { [serverName(req.runId)]: server } }, null, 2), "utf8");
      }
      const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
      const images = req.prompt.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.path : ""));
      const notes = allowanceNotes(req.permissionMode, req.tools);
      const bridgeNote = useBridge
        ? `Your AgenticView tools (${req.bridgeTools.map((t) => t.name).join(", ")}) are on the MCP server "${serverName(req.runId)}"; do not use other MCP servers named agenticview-*.`
        : "";
      let promptText = [req.systemPrompt, notes.join(" "), bridgeNote, ...textParts].filter(Boolean).join("\n\n");
      if (promptText.length > MAX_ARG_PROMPT) {
        const promptFile = join(dir, "prompt.md");
        await writeFile(promptFile, promptText, "utf8");
        promptText = `The full task is in the file ${promptFile}. Read that whole file first, then follow it exactly.`;
      }
      const base = { prompt: promptText, model: req.model, sessionId: req.sessionId, permissionMode: req.permissionMode, tools: req.tools, mcpConfig, attachments: images };
      let effort = req.effort;
      for (;;) {
        const usageFile = join(dir, `usage-${Date.now()}.json`);
        const out = await this.attempt(req, buildCopilotArgs({ ...base, effort, usageFile }), usageFile, sink, signal);
        if (out.retryWithoutEffort && effort) {
          sink({ type: "status", text: `copilot: model ${req.model} takes no reasoning effort; running without it` });
          effort = undefined;
          continue;
        }
        return out.result;
      }
    } catch (e) {
      if (signal.aborted) return { text: "", stopReason: "aborted", sessionId: req.sessionId };
      return { text: "", stopReason: "error", error: extractCliError((e as Error).message), sessionId: req.sessionId };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async attempt(req: RunRequest, args: string[], usageFile: string, sink: EventSink, signal: AbortSignal): Promise<{ result: RunResult; retryWithoutEffort?: boolean }> {
    let text = "";
    let sessionId: string | undefined = req.sessionId;
    let child: ChildProcess | undefined;
    const onAbort = () => {
      if (child) killTree(child, this.platform, this.spawn);
    };
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      const { command, prefix } = await this.command();
      child = this.spawn(command, [...prefix, ...args], { cwd: req.cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      const stderr: string[] = [];
      child.stderr?.on("data", (d) => {
        for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderr.push(l);
        if (stderr.length > 200) stderr.splice(0, stderr.length - 200);
      });
      const exit = new Promise<number | null>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("close", (code) => resolve(code));
      });
      const state = newCopilotMapState(req.cwd);
      let final: CopilotLineResult["result"];
      let emitted = 0;
      const rl = createInterface({ input: child.stdout! });
      for await (const line of rl) {
        const m = mapCopilotLine(line, state);
        if (m.sessionId) sessionId = m.sessionId;
        if (m.result) final = m.result;
        for (const ev of m.events) {
          emitted++;
          if (ev.type === "text") text += (text ? "\n\n" : "") + ev.text;
          sink(ev);
        }
      }
      const code = await exit;
      if (signal.aborted) return { result: { text, stopReason: "aborted", sessionId } };
      let usage: Tokens | undefined;
      try {
        usage = this.usage.delta(sessionId, !!req.sessionId, usageTotals(JSON.parse(await readFile(usageFile, "utf8"))));
      } catch {
        usage = undefined;
      }
      const exitCode = final?.exitCode ?? code;
      if (exitCode !== 0) {
        const raw = stderr.length ? stderr.slice(-20).join("\n") : `copilot exited with code ${exitCode}`;
        if (emitted === 0 && EFFORT_REJECTED.test(raw)) return { result: { text, stopReason: "error", error: extractCliError(raw), sessionId }, retryWithoutEffort: true };
        return { result: { text, stopReason: "error", error: extractCliError(raw), sessionId, usage } };
      }
      if (!final) {
        const raw = stderr.length ? stderr.slice(-20).join("\n") : "copilot ended without a result";
        return { result: { text, stopReason: "error", error: extractCliError(raw), sessionId, usage } };
      }
      return { result: { text, stopReason: "done", sessionId, usage } };
    } catch (e) {
      if (signal.aborted) return { result: { text, stopReason: "aborted", sessionId } };
      return { result: { text, stopReason: "error", error: extractCliError((e as Error).message), sessionId } };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
