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
import { modelFamily, sessionModelMatches, WORK_COMMAND } from "@agenticview/shared";
import { liveInstance } from "./instances.js";
import { SessionRuntime } from "./runtimes/session.js";
/** Fallback identity when the skill could not pass Claude Code's session id. */
const processWorkerId = SessionRuntime.newWorkerId();
const state = { sessionId: processWorkerId, runs: new Map() };
/** Test helper: forget the held tasks and identity. */
export function resetWorkerState() {
    state.office = undefined;
    state.runs.clear();
    state.sessionId = processWorkerId;
    state.model = undefined;
    state.agent = undefined;
}
/** Run ids this worker holds (tests and the next_task poll). */
export function heldRuns() {
    return [...state.runs.keys()];
}
const reply = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });
/** Find the office for `start` or its nearest ancestor with one running, else the hub. */
export async function discoverOffice(start) {
    let dir = resolve(start);
    for (;;) {
        const inst = await liveInstance(dir);
        if (inst)
            return inst;
        const up = dirname(dir);
        if (up === dir)
            break;
        dir = up;
    }
    return liveInstance(null);
}
function startDir(project) {
    return project || process.env.AGENTICVIEW_PROJECT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
/**
 * A usable session id, or undefined. The skill passes `${CLAUDE_SESSION_ID}`; if Claude Code did not
 * substitute it the literal placeholder arrives, which we ignore.
 */
export function cleanSessionId(v) {
    if (typeof v !== "string")
        return undefined;
    const s = v.trim();
    return /^[\w-]{1,64}$/.test(s) ? s : undefined;
}
/**
 * POST JSON to the office with node:http. Deliberately not `fetch`: Node's fetch (undici) aborts
 * any response whose headers take longer than 300s (headersTimeout), which broke long bridge calls
 * such as a Manager's await_tasks. node:http has no such default; the caller's signal is the limit.
 */
export function postJson(url, headers, body, signal) {
    return new Promise((resolvePost, reject) => {
        const data = Buffer.from(JSON.stringify(body ?? {}));
        const req = request(url, { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": String(data.length) }, signal }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("error", reject);
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let json = {};
                try {
                    json = text ? JSON.parse(text) : {};
                }
                catch {
                    // Non-JSON error bodies are reported by status below.
                }
                resolvePost({ status: res.statusCode ?? 0, json: json });
            });
        });
        req.on("error", reject);
        // No socket idle timeout: an await_tasks call may legitimately wait for minutes.
        req.setTimeout(0);
        req.end(data);
    });
}
async function post(inst, path, body, signal) {
    const { status, json } = await postJson(`${inst.url}${path}`, { "x-agenticview-token": inst.token, "x-agenticview-worker": state.sessionId }, body, signal);
    if (status === 401)
        throw new Error("The office rejected this worker's token (it was probably restarted). Call agenticview_next_task again.");
    if (status < 200 || status >= 300)
        throw new Error(`Office returned HTTP ${status}`);
    return json;
}
const NO_OFFICE = "No AgenticView office is running for this project (or the hub). Open it first with /agenticview, then call agenticview_next_task again. Stop looping if the user did not ask you to wait.";
function recentWorkLines(t) {
    const work = t.recentWork ?? [];
    if (work.length === 0)
        return ["(none yet: this is the agent's first task here)"];
    return work.map((w) => {
        const when = w.finishedAt ? ` ${w.finishedAt.slice(0, 16).replace("T", " ")}` : "";
        const files = w.files.length ? ` [files: ${w.files.join(", ")}]` : "";
        const sub = w.subagentId ? ` (subagent id ${w.subagentId}${w.sessionName ? ` in "${w.sessionName}"` : ""})` : "";
        return `- [${w.status}] "${w.title}" (task ${w.taskId}${when})${sub}: ${w.summary || "(no result text)"}${files}`;
    });
}
/** The full text of one task: what the coordinator passes, unchanged, to the agent's subagent. */
export function formatTask(t) {
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
        `run_id: ${t.runId}   (pass this run_id to every agenticview_report / agenticview_complete / agenticview_bridge call)`,
        t.taskId ? `Office task: ${t.taskId}` : "",
        t.redelivered ? "(This task was already claimed by this session before a reconnect: continue it where you left off, then complete it.)" : "",
        `You are the office agent "${t.agent.name}" (${t.agent.role}${t.agent.specialty ? `, ${t.agent.specialty}` : ""}).`,
        t.session ? `Claude Code session: "${t.session.name}" (${t.agent.name} is served by it)` : "",
        `Working directory: ${t.cwd}`,
        `Permission mode: ${t.permissionMode}`,
        t.model ? `Requested model: ${t.model}${t.subagent && modelFamily(t.model) ? ` (the ${t.subagent} subagent runs on ${modelFamily(t.model)})` : " (informational; keep using this session's model)"}` : "",
        mismatch && !(t.subagent && modelFamily(t.model))
            ? `MODEL MISMATCH: the office asked for "${t.model}" but this session reported "${t.session.model}". Say so in your first agenticview_report ("Session is on ${t.session.model}; run /model ${t.model} in this session to switch") and carry on with the current model. Never try to switch models yourself.`
            : "",
        t.effort ? `Requested effort: ${t.effort} (scale how thorough you are to this level)` : "",
        "",
        "## Allowed tools",
        ...allowed.map((a) => `- ${a}`),
        "",
        "## Office tools (call with agenticview_bridge {run_id, tool, args})",
        bridge,
        t.bridgeTools.some((b) => b.name === "await_tasks")
            ? '(await_tasks returns after about 4 minutes with "stillRunning" when tasks are not done yet: call it again with those ids until everything has finished.)'
            : "",
        "",
        "## Agent system prompt",
        t.systemPrompt,
        "",
        "## Your recent work (newest first; continue from it, do not redo it)",
        ...recentWorkLines(t),
        "",
        "## Task",
        t.prompt,
        t.images.length ? `\n## Attached images (read these files)\n${t.images.map((i) => `- ${i}`).join("\n")}` : "",
        "",
        `When finished call agenticview_complete {run_id: "${t.runId}", result} with your final answer (or {run_id, error}). Report progress with agenticview_report {run_id: "${t.runId}", text}.`,
    ]
        .filter((l) => l !== "")
        .join("\n");
}
/** One claimed task as the coordinator sees it: how to launch it, then the text to hand over. */
export function formatDispatch(t, i, n) {
    const head = t.subagent
        ? `Launch the \`${t.subagent}\` subagent IN THE BACKGROUND (Agent tool, subagent_type "${t.subagent}", description "${t.agent.name}: ${t.runId}") with the task text below as its prompt, verbatim.`
        : `No subagent file for ${t.agent.name} here: do this task yourself in the main thread (it is the only one you run yourself), passing run_id "${t.runId}" to every worker tool call.`;
    return [`=== Task ${i + 1} of ${n}: ${t.agent.name}, run_id ${t.runId} ===`, head, "", formatTask(t)].join("\n");
}
/** Remember who this session is (every tool may pass it; the latest wins). */
function identify(args) {
    const id = cleanSessionId(args.session_id);
    if (id)
        state.sessionId = id;
    if (typeof args.model === "string" && args.model.trim())
        state.model = args.model.trim().slice(0, 120);
    if (typeof args.agent === "string")
        state.agent = args.agent.trim().replace(/^["']|["']$/g, "").slice(0, 40) || undefined;
}
function cancelledText(ids) {
    return ids
        .map((id) => {
        const r = state.runs.get(id);
        return `CANCELLED: run_id ${id}${r ? ` (${r.agent}${r.subagent ? `, subagent ${r.subagent}` : ""})` : ""} is no longer active in the office. Stop that subagent now (TaskStop) and do not complete it.`;
    })
        .join("\n");
}
export async function nextTask(args) {
    identify(args);
    state.office = await discoverOffice(startDir(args.project));
    if (!state.office)
        return reply(NO_OFFICE, true);
    const deadline = Date.now() + Math.min(3600, Math.max(1, args.wait_seconds ?? 600)) * 1000;
    const session = { model: state.model, cwd: startDir(args.project), agent: state.agent };
    const max = typeof args.max_tasks === "number" ? Math.max(0, Math.floor(args.max_tasks)) : undefined;
    for (;;) {
        const waitMs = Math.min(25_000, Math.max(0, deadline - Date.now()));
        try {
            const res = await post(state.office, "/api/worker/claim", { waitMs, session, holding: heldRuns(), ...(max !== undefined ? { max } : {}) }, AbortSignal.timeout(waitMs + 10_000));
            const cancelled = res.cancelled ?? [];
            const notice = cancelled.length ? cancelledText(cancelled) : "";
            for (const id of cancelled)
                state.runs.delete(id);
            // Finished elsewhere (or unknown after an office restart): nothing to stop, just forget them.
            for (const id of res.gone ?? [])
                state.runs.delete(id);
            const tasks = res.tasks ?? (res.task ? [res.task] : []);
            for (const t of tasks)
                state.runs.set(t.runId, { office: state.office, agent: t.agent.name, subagent: t.subagent ?? null });
            const status = `This session holds ${state.runs.size} of ${res.capacity ?? "?"} task slots.`;
            if (tasks.length) {
                return reply([`${tasks.length} task${tasks.length === 1 ? "" : "s"} claimed. ${status}`, notice, ...tasks.map((t, i) => formatDispatch(t, i, tasks.length))].filter(Boolean).join("\n\n"));
            }
            if (notice)
                return reply(`${notice}\n\n${status}`);
            // max_tasks 0: only a check for cancellations, never a wait.
            if (max === 0)
                return reply(`No cancellations. ${status}`);
        }
        catch {
            // Office restarted or went away: rediscover, and give up if it is gone.
            await new Promise((r) => setTimeout(r, 2000));
            state.office = await discoverOffice(startDir(args.project));
            if (!state.office)
                return reply(NO_OFFICE, true);
        }
        if (Date.now() >= deadline)
            break;
    }
    const running = heldRuns();
    return reply(running.length
        ? `No new task yet. Still running: ${running.map((id) => `${id} (${state.runs.get(id).agent})`).join(", ")}. Call agenticview_next_task again (short wait_seconds while subagents run).`
        : "No task arrived yet. Call agenticview_next_task again to keep waiting (the office shows this session as a connected worker while you poll).");
}
function ackText(ack, okText, runId) {
    if (ack.ok)
        return reply(ack.result ?? okText);
    if (ack.cancelled)
        state.runs.delete(runId);
    return reply(`ERROR: ${ack.error ?? "unknown error"}`, true);
}
/**
 * The run a call is about: `run_id` when given (a run this worker lost track of after a restart is
 * still accepted), else the only run held. Several held runs make run_id mandatory.
 */
async function resolveRun(runId) {
    const id = typeof runId === "string" ? runId.trim() : "";
    if (id) {
        const held = state.runs.get(id);
        if (held)
            return { runId: id, office: held.office };
        const office = state.office ?? (await discoverOffice(startDir()));
        if (!office)
            return reply(NO_OFFICE, true);
        return { runId: id, office };
    }
    const ids = heldRuns();
    if (ids.length === 1)
        return { runId: ids[0], office: state.runs.get(ids[0]).office };
    if (ids.length === 0)
        return reply("No active AgenticView task. Call agenticview_next_task first (or pass run_id).", true);
    return reply(`This session runs ${ids.length} tasks at once: pass run_id (one of ${ids.join(", ")}).`, true);
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
export async function report(args) {
    identify(args);
    const cur = await resolveRun(args.run_id);
    if ("content" in cur)
        return cur;
    const events = [...(args.text ? [{ type: "text", text: args.text }] : []), ...(args.events ?? [])];
    try {
        return ackText(await post(cur.office, `/api/worker/${cur.runId}/report`, { events, subagentId: args.subagent_id }), "Reported.", cur.runId);
    }
    catch (e) {
        return reply(`ERROR: ${e.message}`, true);
    }
}
export async function complete(args) {
    identify(args);
    const cur = await resolveRun(args.run_id);
    if ("content" in cur)
        return cur;
    try {
        const ack = await post(cur.office, `/api/worker/${cur.runId}/complete`, { text: args.result, error: args.error, subagentId: args.subagent_id });
        state.runs.delete(cur.runId);
        return ackText(ack, `Task ${cur.runId} completed.${state.runs.size ? ` ${state.runs.size} still running in this session.` : ""}`, cur.runId);
    }
    catch (e) {
        return reply(`ERROR: ${e.message}`, true);
    }
}
export async function bridge(args) {
    identify(args);
    const cur = await resolveRun(args.run_id);
    if ("content" in cur)
        return cur;
    try {
        return ackText(await post(cur.office, `/api/worker/${cur.runId}/bridge`, { name: args.tool, args: args.args ?? {} }), "", cur.runId);
    }
    catch (e) {
        return reply(`ERROR: ${e.message}`, true);
    }
}
const SESSION_ID_HINT = "This Claude Code session's id: pass ${CLAUDE_SESSION_ID} exactly as the skill says, so the office recognises the session again after it is reopened (subagents may omit it)";
const RUN_ID_HINT = "The task's run_id (from its '# AgenticView task <run_id>' heading). Required when the session runs more than one task";
const SUBAGENT_ID_HINT = "Optional: the Claude Code subagent/agent id serving this run, if known (shown in the office; lets the session continue that subagent later)";
export async function main() {
    const server = new McpServer({ name: "agenticview-worker", version: "0.3.0" });
    server.registerTool("agenticview_next_task", {
        description: "Coordinator only: wait for AgenticView office tasks for the 'Claude Code session' provider and claim up to max_tasks of them (default: every free slot of this session). Blocks up to wait_seconds (default 600) until at least one arrives. Each task names the subagent to launch and its run_id. Also reports runs the office cancelled.",
        inputSchema: {
            wait_seconds: z.number().int().min(1).max(3600).optional().describe("How long to wait for a task (default 600; use 20-30 while subagents are running)"),
            max_tasks: z.number().int().min(0).max(8).optional().describe("Most tasks to claim now (your free slots); default: every free slot of this session"),
            project: z.string().optional().describe("Project folder whose office to serve (default: this session's folder, falling back to the hub)"),
            session_id: z.string().optional().describe(SESSION_ID_HINT),
            model: z.string().optional().describe("The model this session is running on right now (its exact id or name from your system prompt), so the office can show it"),
            agent: z.string().optional().describe(`Office agent to bind to this session (the argument of ${WORK_COMMAND} <agent>); omit to serve any agent`),
        },
    }, async (args) => nextTask(args));
    server.registerTool("agenticview_report", {
        description: "Stream progress for a task to the office feed. Pass run_id, a short `text` update and/or structured `events` (tool_start/tool_end with name and summary, file_changed with path and kind).",
        inputSchema: {
            run_id: z.string().optional().describe(RUN_ID_HINT),
            text: z.string().optional().describe("A brief progress note shown in the agent's chat"),
            events: z.array(EventSchema).optional(),
            subagent_id: z.string().optional().describe(SUBAGENT_ID_HINT),
            session_id: z.string().optional().describe(SESSION_ID_HINT),
        },
    }, async (args) => report(args));
    server.registerTool("agenticview_complete", {
        description: "Finish a task: pass run_id and `result` (the final answer shown to the user) or `error` if it could not be done.",
        inputSchema: {
            run_id: z.string().optional().describe(RUN_ID_HINT),
            result: z.string().optional(),
            error: z.string().optional(),
            subagent_id: z.string().optional().describe(SUBAGENT_ID_HINT),
            session_id: z.string().optional().describe(SESSION_ID_HINT),
        },
    }, async (args) => complete(args));
    server.registerTool("agenticview_bridge", {
        description: "Call one of a task's office tools (listed under 'Office tools' in the task), e.g. assign_task/await_tasks for a Manager, or take_screenshot for workers. Pass run_id. await_tasks returns after about 4 minutes with 'stillRunning' ids if tasks are not done; call it again with those ids.",
        inputSchema: {
            run_id: z.string().optional().describe(RUN_ID_HINT),
            tool: z.string().describe("Office tool name"),
            args: z.record(z.string(), z.unknown()).optional(),
            session_id: z.string().optional().describe(SESSION_ID_HINT),
        },
    }, async (args) => bridge(args));
    await server.connect(new StdioServerTransport());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
//# sourceMappingURL=worker-mcp.js.map