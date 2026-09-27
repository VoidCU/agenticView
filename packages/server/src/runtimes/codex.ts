import type { PermissionMode, Provider, ProviderStatus, RunEvent, RunResult, ToolAllowance } from "@agenticview/shared";
import type { Codex as CodexClass, ThreadEvent, ThreadItem, UserInput, SandboxMode } from "@openai/codex-sdk";
import type { EventSink, Runtime, RunRequest } from "./types.js";
import { which as defaultWhich, type Which } from "./which.js";
import { extractCliError } from "./errors.js";

export interface CodexSdk {
  Codex: typeof CodexClass;
}

export interface CodexCustomEndpoint {
  /** Provider id this runtime serves ("custom:<slug>"). */
  provider: Provider;
  /** Display name (model_providers.<id>.name). */
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** Model used when the agent sets none. */
  defaultModel?: string | null;
}

export interface CodexRuntimeOptions {
  sdk?: CodexSdk;
  /** Run against a custom OpenAI-compatible endpoint instead of OpenAI (engine "openai" custom providers). */
  custom?: CodexCustomEndpoint;
  bridgeEntry: string;
  bridgeUrl: () => string;
  apiKey?: string;
  which?: Which;
}

export const CODEX_MISSING_REASON = "Install the Codex CLI (npm i -g @openai/codex) and sign in with `codex login` or set CODEX_API_KEY.";

/**
 * Permission mode → Codex sandbox. `ask` cannot prompt through the SDK, so it is read-only (the most
 * restrictive setting). Codex's Windows sandbox cannot write files, so `auto-edit` needs full access there.
 */
export function sandboxFor(mode: PermissionMode, platform: NodeJS.Platform = process.platform, tools?: ToolAllowance): SandboxMode {
  if (tools && !tools.edit && !tools.shell) return "read-only";
  if (mode === "ask") return "read-only";
  if (mode === "auto") return "danger-full-access";
  return platform === "win32" ? "danger-full-access" : "workspace-write";
}

function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .join(" ")
    .trim();
}

/** Pure mapping from Codex thread events to RunEvents. `started` tracks tool items that already emitted tool_start. */
export function mapCodexEvent(ev: ThreadEvent, started: Set<string>): RunEvent[] {
  const out: RunEvent[] = [];
  if (ev.type !== "item.started" && ev.type !== "item.completed") return out;
  const item: ThreadItem = ev.item;
  const id = item.id ?? `${item.type}-${Math.random()}`;
  const start = (name: string, input: unknown) => {
    if (started.has(id)) return;
    started.add(id);
    out.push({ type: "tool_start", name, input });
  };
  switch (item.type) {
    case "reasoning":
      if (ev.type === "item.started") out.push({ type: "status", text: "thinking" });
      break;
    case "agent_message":
      if (ev.type === "item.completed" && item.text) out.push({ type: "text", text: item.text });
      break;
    case "command_execution":
      start("bash", { command: item.command });
      if (ev.type === "item.completed") {
        out.push({ type: "tool_end", name: "bash", ok: item.status !== "failed" && (item.exit_code ?? 0) === 0, summary: (item.aggregated_output ?? item.command).slice(0, 200) });
      }
      break;
    case "file_change":
      if (ev.type === "item.completed") {
        if (item.status === "failed") {
          out.push({ type: "status", text: `patch failed: ${(item.changes ?? []).map((c) => c.path).join(", ")}` });
          break;
        }
        for (const c of item.changes ?? []) {
          out.push({ type: "file_changed", path: c.path, kind: c.kind === "add" ? "create" : c.kind === "delete" ? "delete" : "modify" });
        }
      }
      break;
    case "mcp_tool_call":
      start(item.tool, item.arguments);
      if (ev.type === "item.completed") {
        const ok = item.status !== "failed" && !item.error;
        out.push({ type: "tool_end", name: item.tool, ok, summary: (item.error?.message ?? textOf(item.result?.content)).slice(0, 200) });
      }
      break;
    case "web_search":
      start("web_search", { query: item.query });
      if (ev.type === "item.completed") out.push({ type: "tool_end", name: "web_search", ok: true, summary: item.query });
      break;
    case "error":
      if (ev.type === "item.completed") out.push({ type: "status", text: `error: ${item.message}` });
      break;
    default:
      break;
  }
  return out;
}

export class CodexRuntime implements Runtime {
  readonly provider: Provider;
  private sdk?: CodexSdk;
  private readonly which: Which;

  constructor(private readonly opts: CodexRuntimeOptions) {
    this.sdk = opts.sdk;
    this.which = opts.which ?? defaultWhich;
    this.provider = opts.custom?.provider ?? "codex";
  }

  async check(): Promise<ProviderStatus> {
    const bin = await this.which("codex");
    if (!bin) return { provider: this.provider, ok: false, reason: this.opts.custom ? `${this.opts.custom.name} runs through the Codex CLI: ${CODEX_MISSING_REASON}` : CODEX_MISSING_REASON };
    return { provider: this.provider, ok: true, version: this.opts.custom ? `codex via ${this.opts.custom.baseUrl}` : bin };
  }

  private async loadSdk(): Promise<CodexSdk> {
    if (!this.sdk) this.sdk = (await import("@openai/codex-sdk")) as unknown as CodexSdk;
    return this.sdk;
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    let text = "";
    let sessionId: string | undefined = req.sessionId;
    try {
      if (signal.aborted) return { text, stopReason: "aborted" };
      const sdk = await this.loadSdk();
      const { env, config } = codexEnvAndConfig(process.env, this.opts);
      if (req.bridgeTools.length > 0) {
        config.mcp_servers = {
          agenticview: {
            command: process.execPath,
            args: [this.opts.bridgeEntry],
            env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
            // Newer Codex asks before every MCP tool call, separately from approval_policy; nobody can answer that
            // prompt in a headless run, so the bridge tools (delegate, report, ...) are pre-approved.
            default_tools_approval_mode: "approve",
          },
        };
      }
      const codex = new sdk.Codex({ env, config: config as never });
      const threadOpts = codexThreadOptions(req, process.platform);
      if (this.opts.custom && !threadOpts.model && this.opts.custom.defaultModel) threadOpts.model = this.opts.custom.defaultModel;
      const thread = req.sessionId ? codex.resumeThread(req.sessionId, threadOpts) : codex.startThread(threadOpts);

      const input: UserInput[] = [];
      const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
      input.push({ type: "text", text: [req.systemPrompt, ...textParts].filter(Boolean).join("\n\n") });
      for (const p of req.prompt) if (p.type === "image") input.push({ type: "local_image", path: p.path });

      const { events } = await thread.runStreamed(input, { signal });
      const started = new Set<string>();
      let failure: string | undefined;
      let usage: RunResult["usage"];
      let rateLimits: RunResult["rateLimits"];
      try {
        for await (const rawEv of events) {
          const ev = rawEv as ThreadEvent & { rate_limits?: RunResult["rateLimits"] };
          if (signal.aborted) return { text, stopReason: "aborted", sessionId };
          if (ev.type === "thread.started") sessionId = ev.thread_id;
          else if (ev.type === "turn.completed") {
            usage = { inputTokens: ev.usage?.input_tokens ?? 0, outputTokens: ev.usage?.output_tokens ?? 0 };
            if (ev.rate_limits) rateLimits = ev.rate_limits;
          } else if (ev.type === "turn.failed") {
            failure = extractCliError(ev.error?.message ?? "turn failed");
            if (ev.rate_limits) rateLimits = ev.rate_limits;
          } else if (ev.type === "error") {
            failure = extractCliError(ev.message);
            if (ev.rate_limits) rateLimits = ev.rate_limits;
          } else if ((ev as { type: string }).type === "rate_limits" || ev.rate_limits) {
            rateLimits = ev.rate_limits ?? (ev as unknown as RunResult["rateLimits"]);
          }
          for (const mapped of mapCodexEvent(ev, started)) {
            // Codex has no metadata for a custom endpoint's models and says so on every run; not an error for the user.
            if (this.opts.custom && mapped.type === "status" && /^error: Model metadata for/.test(mapped.text)) continue;
            if (mapped.type === "text") text += (text ? "\n\n" : "") + mapped.text;
            sink(mapped);
          }
        }
      } catch (streamErr) {
        if (!failure) {
          failure = extractCliError((streamErr as Error).message);
        }
      }
      sessionId = thread.id ?? sessionId;
      if (failure) return { text, stopReason: "error", error: failure, sessionId, usage, rateLimits };
      return { text, stopReason: "done", sessionId, usage, rateLimits };
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted", sessionId };
      return { text, stopReason: "error", error: extractCliError((e as Error).message), sessionId };
    }
  }
}

/** ThreadOptions for a run: sandbox, plus model and `modelReasoningEffort` when the agent sets them. */
export function codexThreadOptions(req: RunRequest, platform: NodeJS.Platform): Record<string, unknown> {
  const opts: Record<string, unknown> = { workingDirectory: req.cwd, skipGitRepoCheck: true, sandboxMode: sandboxFor(req.permissionMode, platform, req.tools) };
  if (req.model) opts.model = req.model;
  if (req.effort) opts.modelReasoningEffort = req.effort;
  return opts;
}

/** Env var a custom endpoint's key is passed in (model_providers.<id>.env_key); only ever in the child env. */
export const CUSTOM_KEY_ENV = "AGENTICVIEW_CUSTOM_KEY";

/** Codex config-table id for a custom provider ("custom:my-llm" -> "agenticview_my_llm"). */
export function codexProviderId(provider: string): string {
  return `agenticview_${provider.replace(/^custom:/, "").replace(/[^a-z0-9]/gi, "_")}`;
}

/**
 * Child env and `--config` overrides for one Codex run. For a custom OpenAI-compatible endpoint the
 * overrides define `model_providers.<id>` (Responses API; codex 0.156 dropped the chat wire API) and select
 * it with `model_provider`, so the user's ~/.codex config and login stay untouched. Keys go to the child
 * env only, never into this process's env.
 */
export function codexEnvAndConfig(
  base: NodeJS.ProcessEnv,
  opts: Pick<CodexRuntimeOptions, "apiKey" | "custom">,
): { env: Record<string, string>; config: Record<string, unknown> } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (typeof v === "string") env[k] = v;
  const config: Record<string, unknown> = { approval_policy: "never" };
  const custom = opts.custom;
  if (custom) {
    const id = codexProviderId(custom.provider);
    const entry: Record<string, unknown> = { name: custom.name, base_url: custom.baseUrl, wire_api: "responses" };
    delete env[CUSTOM_KEY_ENV];
    if (custom.apiKey) {
      env[CUSTOM_KEY_ENV] = custom.apiKey;
      entry.env_key = CUSTOM_KEY_ENV;
    }
    config.model_provider = id;
    config.model_providers = { [id]: entry };
  } else if (opts.apiKey && !env.CODEX_API_KEY) {
    env.CODEX_API_KEY = opts.apiKey;
  }
  return { env, config };
}
