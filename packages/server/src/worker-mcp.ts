#!/usr/bin/env node
/**
 * Stdio MCP server loaded by Claude Code from the plugin's .mcp.json. It turns the user's own
 * Claude Code session into an AgenticView worker for the `claude-session` provider: the session
 * pulls queued runs from the office for its project and does them with its own tools.
 *
 * Nothing here launches `claude` or the Agent SDK. It only talks to the local office over HTTP.
 */
import { request } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sessionModelMatches, WORK_COMMAND } from "@agenticview/shared";
import { liveInstance, type Instance } from "./instances.js";
import { SessionRuntime, type SessionTask } from "./runtimes/session.js";

/** Fallback identity when the skill could not pass Claude Code's session id. */
const processWorkerId = SessionRuntime.newWorkerId();

interface State {
  office?: Instance;
  current?: { runId: string; office: Instance };
  /** Claude Code session id (from the skill's ${CLAUDE_SESSION_ID}), else a per-process id. */
  sessionId: string;
  model?: string;
  agent?: string;
}
const state: State = { sessionId: processWorkerId };

/** Test helper: forget the current task and identity. */
export function resetWorkerState(): void {
  state.office = undefined;
  state.current = undefined;
  state.sessionId = processWorkerId;
  state.model = undefined;
  state.agent = undefined;
}

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };
const reply = (text: string, isError = false): ToolText => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

/** Find the office for `start` or its nearest ancestor with one running, else the hub. */
export async function discoverOffice(start: string): Promise<Instance | undefined> {
  let dir = resolve(start);
  for (;;) {
    const inst = await liveInstance(dir);
    if (inst) return inst;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return liveInstance(null);
}

function startDir(project?: string): string {
  return project || process.env.AGENTICVIEW_PROJECT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * A usable session id, or undefined. The skill passes `${CLAUDE_SESSION_ID}`; if Claude Code did not
 * substitute it the literal placeholder arrives, which we ignore.
 */
export function cleanSessionId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return /^[\w-]{1,64}$/.test(s) ? s : undefined;
}

/**
 * POST JSON to the office with node:http. Deliberately not `fetch`: Node's fetch (undici) aborts
 * any response whose headers take longer than 300s (headersTimeout), which broke long bridge calls
 * such as a Manager's await_tasks. node:http has no such default; the caller's signal is the limit.
 */
export function postJson<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: T }> {
  return new Promise((resolvePost, reject) => {
    const data = Buffer.from(JSON.stringify(body ?? {}));
    const req = request(url, { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": String(data.length) }, signal }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          // Non-JSON error bodies are reported by status below.
        }
        resolvePost({ status: res.statusCode ?? 0, json: json as T });
      });
    });
    req.on("error", reject);
    // No socket idle timeout: an await_tasks call may legitimately wait for minutes.
    req.setTimeout(0);
    req.end(data);
  });
}

async function post<T>(inst: Instance, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { status, json } = await postJson<T>(`${inst.url}${path}`, { "x-agenticview-token": inst.token, "x-agenticview-worker": state.sessionId }, body, signal);
  if (status === 401) throw new Error("The office rejected this worker's token (it was probably restarted). Call agenticview_next_task again.");
  if (status < 200 || status >= 300) throw new Error(`Office returned HTTP ${status}`);
  return json;
}

const NO_OFFICE =
  "No AgenticView office is running for this project (or the hub). Open it first with /agenticview, then call agenticview_next_task again. Stop looping if the user did not ask you to wait.";

export function formatTask(t: SessionTask): string {
  const allowed = [
    t.tools.edit ? "file edits: ALLOWED" : "file edits: NOT allowed (do not use Edit/Write/MultiEdit or anything that changes files)",
    t.tools.shell ? "shell commands: ALLOWED" : "shell commands: NOT allowed (do not use Bash)",
    t.tools.web ? "web access: ALLOWED" : "web access: NOT allowed (do not use WebFetch/WebSearch)",
  ];
  const bridge = t.bridgeTools.length
    ? t.bridgeTools.map((b) => `- ${b.name}: ${b.description}\n  args schema: ${JSON.stringify(b.inputSchema)}`).join("\n")
    : "(none)";
  const mismatch = t.model && t.session?.model && !sessionModelMatches(t.model, t.session.model);
  return [
    `# AgenticView task ${t.runId}`,
    t.redelivered ? "(This task was already yours before a reconnect: continue it where you left off, then complete it.)" : "",
    `You are now acting as the office agent "${t.agent.name}" (${t.agent.role}${t.agent.specialty ? `, ${t.agent.specialty}` : ""}).`,
    t.session ? `Claude Code session: "${t.session.name}" (this session; ${t.agent.name} is served by it)` : "",
    `Working directory: ${t.cwd}`,
    `Permission mode: ${t.permissionMode}`,
    t.model ? `Requested model: ${t.model} (informational; keep using this session's model)` : "",
    mismatch
      ? `MODEL MISMATCH: the office asked for "${t.model}" but this session reported "${t.session!.model}". Say so in your first agenticview_report ("Session is on ${t.session!.model}; run /model ${t.model} in this session to switch") and carry on with the current model. Never try to switch models yourself.`
      : "",
    t.effort ? `Requested effort: ${t.effort} (scale how thorough you are to this level)` : "",
    "",
    "## Allowed tools",
    ...allowed.map((a) => `- ${a}`),
    "",
    "## Office tools (call with agenticview_bridge {tool, args})",
    bridge,
    t.bridgeTools.some((b) => b.name === "await_tasks")
      ? '(await_tasks returns after about 4 minutes with "stillRunning" when tasks are not done yet: call it again with those ids until everything has finished.)'
      : "",
    "",
    "## Agent system prompt",
    t.systemPrompt,
    "",
    "## Task",
    t.prompt,
    t.images.length ? `\n## Attached images (read these files)\n${t.images.map((i) => `- ${i}`).join("\n")}` : "",
    "",
    "When finished call agenticview_complete with your final answer (or an error), then call agenticview_next_task again.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export interface NextTaskArgs {
  wait_seconds?: number;
  project?: string;
  session_id?: string;
  agent?: string;
  model?: string;
}

/** Remember who this session is (every tool may pass it; the latest wins). */
function identify(args: { session_id?: string; model?: string; agent?: string }): void {
  const id = cleanSessionId(args.session_id);
  if (id) state.sessionId = id;
  if (typeof args.model === "string" && args.model.trim()) state.model = args.model.trim().slice(0, 120);
  if (typeof args.agent === "string") state.agent = args.agent.trim().replace(/^["']|["']$/g, "").slice(0, 40) || undefined;
}

export async function nextTask(args: NextTaskArgs): Promise<ToolText> {
  identify(args);
  if (state.current) {
    return reply(`You still have task ${state.current.runId} open. Finish it with agenticview_complete (or report an error) before taking another.`, true);
  }
  state.office = await discoverOffice(startDir(args.project));
  if (!state.office) return reply(NO_OFFICE, true);
  const deadline = Date.now() + Math.min(3600, Math.max(5, args.wait_seconds ?? 600)) * 1000;
  const session = { model: state.model, cwd: startDir(args.project), agent: state.agent };
  while (Date.now() < deadline) {
    const waitMs = Math.min(25_000, Math.max(1000, deadline - Date.now()));
    try {
      const { task } = await post<{ task: SessionTask | null }>(state.office, "/api/worker/claim", { waitMs, session }, AbortSignal.timeout(waitMs + 10_000));
      if (task) {
        state.current = { runId: task.runId, office: state.office };
        return reply(formatTask(task));
      }
    } catch {
      // Office restarted or went away: rediscover, and give up if it is gone.
      await new Promise((r) => setTimeout(r, 2000));
      state.office = await discoverOffice(startDir(args.project));
      if (!state.office) return reply(NO_OFFICE, true);
    }
  }
  return reply("No task arrived yet. Call agenticview_next_task again to keep waiting (the office shows this session as a connected worker while you poll).");
}

type Ack = { ok: boolean; cancelled?: boolean; error?: string; result?: string };

function ackText(ack: Ack, okText: string): ToolText {
  if (ack.ok) return reply(ack.result ?? okText);
  if (ack.cancelled) state.current = undefined;
  return reply(`ERROR: ${ack.error ?? "unknown error"}`, true);
}

function requireCurrent(): { runId: string; office: Instance } | ToolText {
  return state.current ?? reply("No active AgenticView task. Call agenticview_next_task first.", true);
}

const EventSchema = z.object({
  type: z.enum(["text", "status", "tool_start", "tool_end", "file_changed"]),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  ok: z.boolean().optional(),
  summary: z.string().optional(),
  path: z.string().optional(),
  kind: z.enum(["create", "modify", "delete"]).optional(),
});

export async function report(args: { text?: string; events?: z.infer<typeof EventSchema>[]; session_id?: string }): Promise<ToolText> {
  identify(args);
  const cur = requireCurrent();
  if ("content" in cur) return cur;
  const events = [...(args.text ? [{ type: "text" as const, text: args.text }] : []), ...(args.events ?? [])];
  try {
    return ackText(await post<Ack>(cur.office, `/api/worker/${cur.runId}/report`, { events }), "Reported.");
  } catch (e) {
    return reply(`ERROR: ${(e as Error).message}`, true);
  }
}

export async function complete(args: { result?: string; error?: string; session_id?: string }): Promise<ToolText> {
  identify(args);
  const cur = requireCurrent();
  if ("content" in cur) return cur;
  try {
    const ack = await post<Ack>(cur.office, `/api/worker/${cur.runId}/complete`, { text: args.result, error: args.error });
    state.current = undefined;
    return ackText(ack, "Task completed. Call agenticview_next_task for the next one.");
  } catch (e) {
    return reply(`ERROR: ${(e as Error).message}`, true);
  }
}

export async function bridge(args: { tool: string; args?: Record<string, unknown>; session_id?: string }): Promise<ToolText> {
  identify(args);
  const cur = requireCurrent();
  if ("content" in cur) return cur;
  try {
    return ackText(await post<Ack>(cur.office, `/api/worker/${cur.runId}/bridge`, { name: args.tool, args: args.args ?? {} }), "");
  } catch (e) {
    return reply(`ERROR: ${(e as Error).message}`, true);
  }
}

const SESSION_ID_HINT = "This Claude Code session's id: pass ${CLAUDE_SESSION_ID} exactly as the skill says, so the office recognises the session again after it is reopened";

export async function main(): Promise<void> {
  const server = new McpServer({ name: "agenticview-worker", version: "0.2.0" });

  server.registerTool(
    "agenticview_next_task",
    {
      description:
        "Wait for the next AgenticView office task assigned to the 'Claude Code session' provider and claim it. Blocks up to wait_seconds (default 600). Returns the task (agent persona, cwd, allowed tools, prompt) or a message to poll again.",
      inputSchema: {
        wait_seconds: z.number().int().min(5).max(3600).optional().describe("How long to wait for a task (default 600)"),
        project: z.string().optional().describe("Project folder whose office to serve (default: this session's folder, falling back to the hub)"),
        session_id: z.string().optional().describe(SESSION_ID_HINT),
        model: z.string().optional().describe("The model this session is running on right now (its exact id or name from your system prompt), so the office can show it"),
        agent: z.string().optional().describe(`Office agent to bind to this session (the argument of ${WORK_COMMAND} <agent>); omit to serve any agent`),
      },
    },
    async (args) => nextTask(args),
  );

  server.registerTool(
    "agenticview_report",
    {
      description:
        "Stream progress for the current task to the office feed. Pass a short `text` update and/or structured `events` (tool_start/tool_end with name and summary, file_changed with path and kind).",
      inputSchema: {
        text: z.string().optional().describe("A brief progress note shown in the agent's chat"),
        events: z.array(EventSchema).optional(),
        session_id: z.string().optional().describe(SESSION_ID_HINT),
      },
    },
    async (args) => report(args),
  );

  server.registerTool(
    "agenticview_complete",
    {
      description: "Finish the current task. Pass `result` (the final answer shown to the user) or `error` if it could not be done. Then call agenticview_next_task again.",
      inputSchema: { result: z.string().optional(), error: z.string().optional(), session_id: z.string().optional().describe(SESSION_ID_HINT) },
    },
    async (args) => complete(args),
  );

  server.registerTool(
    "agenticview_bridge",
    {
      description:
        "Call one of the current task's office tools (listed under 'Office tools' in the task), e.g. delegate/assign_task/await_tasks for a Manager, or report/ask tools for workers. await_tasks returns after about 4 minutes with 'stillRunning' ids if tasks are not done; call it again with those ids.",
      inputSchema: {
        tool: z.string().describe("Office tool name"),
        args: z.record(z.string(), z.unknown()).optional(),
        session_id: z.string().optional().describe(SESSION_ID_HINT),
      },
    },
    async (args) => bridge(args),
  );

  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
