import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { PermissionMode, ProviderStatus, RunEvent, RunResult } from "@agenticview/shared";
import type { query as sdkQuery, tool as sdkTool, createSdkMcpServer as sdkCreateServer } from "@anthropic-ai/claude-agent-sdk";
import type { EventSink, Runtime, RunRequest } from "./types.js";

export interface ClaudeSdk {
  query: typeof sdkQuery;
  tool: typeof sdkTool;
  createSdkMcpServer: typeof sdkCreateServer;
}

export interface ClaudeRuntimeOptions {
  sdk?: ClaudeSdk;
  apiKey?: string;
}

export const CLAUDE_CREDENTIAL_ENV = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
] as const;

export const CLAUDE_MISSING_KEY_REASON =
  "Set ANTHROPIC_API_KEY (or a cloud provider env). The Agent SDK does not use the Claude Code login.";

const READ_TOOLS = ["Read", "Glob", "Grep"];
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"];
const WEB_TOOLS = ["WebSearch", "WebFetch"];
const MEDIA: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface ClaudeOptionSubset {
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: ClaudePermissionMode;
  allowDangerouslySkipPermissions?: boolean;
}

export function claudeOptionsFor(req: RunRequest): ClaudeOptionSubset {
  const allowed: string[] = [...READ_TOOLS];
  const disallowed: string[] = [];
  if (req.tools.edit) allowed.push(...EDIT_TOOLS);
  else disallowed.push(...EDIT_TOOLS);
  if (req.tools.shell) allowed.push("Bash");
  else disallowed.push("Bash");
  if (req.tools.web) allowed.push(...WEB_TOOLS);
  else disallowed.push(...WEB_TOOLS);
  for (const t of req.bridgeTools) allowed.push(`mcp__agenticview__${t.name}`);
  const modes: Record<PermissionMode, ClaudePermissionMode> = { auto: "bypassPermissions", "auto-edit": "acceptEdits", ask: "default" };
  const permissionMode = modes[req.permissionMode];
  const out: ClaudeOptionSubset = { allowedTools: allowed, disallowedTools: disallowed, permissionMode };
  if (permissionMode === "bypassPermissions") out.allowDangerouslySkipPermissions = true;
  return out;
}

type Block = { type: string; [k: string]: unknown };
type ToolUseInfo = { name: string; input: Record<string, unknown> };

function blocksOf(msg: Record<string, unknown>): Block[] {
  const m = msg.message as { content?: unknown } | undefined;
  const c = m?.content;
  if (typeof c === "string") return [{ type: "text", text: c }];
  return Array.isArray(c) ? (c as Block[]) : [];
}

function summarize(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 200);
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as Block).text === "string" ? (b as Block).text : ""))
      .join(" ")
      .trim()
      .slice(0, 200);
  }
  return "";
}

/** Pure mapping from one SDK message to zero or more RunEvents. `pending` pairs tool results with their tool_use. */
export function mapClaudeMessage(raw: unknown, pending: Map<string, ToolUseInfo>): RunEvent[] {
  const msg = raw as Record<string, unknown>;
  const out: RunEvent[] = [];
  if (!msg || typeof msg !== "object") return out;
  if (msg.type === "assistant") {
    for (const b of blocksOf(msg)) {
      if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) out.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") {
        const info: ToolUseInfo = { name: String(b.name), input: (b.input as Record<string, unknown>) ?? {} };
        if (typeof b.id === "string") pending.set(b.id, info);
        out.push({ type: "tool_start", name: info.name, input: info.input });
      }
    }
  } else if (msg.type === "user") {
    for (const b of blocksOf(msg)) {
      if (b.type !== "tool_result") continue;
      const info = typeof b.tool_use_id === "string" ? pending.get(b.tool_use_id) : undefined;
      if (typeof b.tool_use_id === "string") pending.delete(b.tool_use_id);
      const name = info?.name ?? "tool";
      const ok = b.is_error !== true;
      out.push({ type: "tool_end", name, ok, summary: summarize(b.content) });
      const filePath = info?.input.file_path;
      if (ok && info && EDIT_TOOLS.includes(info.name) && typeof filePath === "string") {
        out.push({ type: "file_changed", path: filePath, kind: info.name === "Write" ? "create" : "modify" });
      }
    }
  }
  return out;
}

function resultOf(msg: Record<string, unknown>, text: string): RunResult {
  const subtype = String(msg.subtype ?? "");
  const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const base: RunResult = {
    text: typeof msg.result === "string" && msg.result.length > 0 ? msg.result : text,
    stopReason: "done",
    sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
    costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
    usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
  };
  if (subtype === "success") return base;
  if (subtype === "error_max_turns") return { ...base, stopReason: "max_turns", error: "error_max_turns" };
  const errors = Array.isArray(msg.errors) ? (msg.errors as unknown[]).map(String).join("; ") : "";
  return { ...base, stopReason: "error", error: errors ? `${subtype}: ${errors}` : subtype };
}

async function imageBlock(path: string): Promise<Block> {
  const data = (await readFile(path)).toString("base64");
  return { type: "image", source: { type: "base64", media_type: MEDIA[extname(path).toLowerCase()] ?? "image/png", data } };
}

export class ClaudeRuntime implements Runtime {
  readonly provider = "claude" as const;
  private sdk?: ClaudeSdk;
  private readonly apiKey?: string;

  constructor(opts: ClaudeRuntimeOptions = {}) {
    this.sdk = opts.sdk;
    this.apiKey = opts.apiKey;
  }

  private hasCredential(): boolean {
    return Boolean(this.apiKey) || CLAUDE_CREDENTIAL_ENV.some((k) => Boolean(process.env[k]));
  }

  async check(): Promise<ProviderStatus> {
    if (this.hasCredential()) return { provider: "claude", ok: true, version: "agent-sdk" };
    return { provider: "claude", ok: false, reason: CLAUDE_MISSING_KEY_REASON };
  }

  private async loadSdk(): Promise<ClaudeSdk> {
    if (!this.sdk) this.sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as ClaudeSdk;
    return this.sdk;
  }

  async run(req: RunRequest, sink: EventSink, signal: AbortSignal): Promise<RunResult> {
    let text = "";
    const injectKey = Boolean(this.apiKey) && !process.env.ANTHROPIC_API_KEY;
    if (injectKey) process.env.ANTHROPIC_API_KEY = this.apiKey;
    try {
      if (signal.aborted) return { text, stopReason: "aborted" };
      const sdk = await this.loadSdk();
      const subset = claudeOptionsFor(req);
      const abortController = new AbortController();
      const onAbort = () => abortController.abort();
      signal.addEventListener("abort", onAbort, { once: true });

      const options: Record<string, unknown> = {
        ...subset,
        cwd: req.cwd,
        systemPrompt: { type: "preset", preset: "claude_code", append: req.systemPrompt },
        maxTurns: req.maxTurns ?? 60,
        settingSources: ["project"],
        abortController,
      };
      if (req.sessionId) options.resume = req.sessionId;
      if (req.model) options.model = req.model;
      if (req.bridgeTools.length > 0) {
        const tools = req.bridgeTools.map((t) =>
          sdk.tool(t.name, t.description, t.schema as never, async (args: unknown) => {
            try {
              return { content: [{ type: "text" as const, text: await t.handler(args as Record<string, unknown>) }] };
            } catch (e) {
              return { content: [{ type: "text" as const, text: `ERROR: ${(e as Error).message}` }], isError: true };
            }
          }),
        );
        options.mcpServers = { agenticview: sdk.createSdkMcpServer({ name: "agenticview", version: "0.1.0", tools }) };
      }
      if (subset.permissionMode === "default") {
        const onPermission = req.onPermission;
        options.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
          if (!onPermission) return { behavior: "deny", message: "No permission handler attached in AgenticView" };
          const id = `${req.runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          sink({ type: "permission", id, tool: toolName, input });
          const allow = await onPermission({ id, tool: toolName, input });
          return allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Denied by user in AgenticView" };
        };
      }

      const content: Block[] = [];
      for (const p of req.prompt) {
        if (p.type === "text") content.push({ type: "text", text: p.text });
        else content.push(await imageBlock(p.path));
      }
      const prompt = (async function* () {
        yield { type: "user" as const, message: { role: "user" as const, content }, parent_tool_use_id: null };
      })();

      const pending = new Map<string, ToolUseInfo>();
      try {
        for await (const raw of sdk.query({ prompt: prompt as never, options: options as never })) {
          const msg = raw as unknown as Record<string, unknown>;
          if (msg.type === "result") return resultOf(msg, text);
          for (const ev of mapClaudeMessage(msg, pending)) {
            if (ev.type === "text") text += ev.text;
            sink(ev);
          }
        }
        return { text, stopReason: signal.aborted ? "aborted" : "error", error: signal.aborted ? undefined : "Agent SDK ended without a result" };
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } catch (e) {
      if (signal.aborted) return { text, stopReason: "aborted" };
      return { text, stopReason: "error", error: (e as Error).message };
    } finally {
      if (injectKey) delete process.env.ANTHROPIC_API_KEY;
    }
  }
}
