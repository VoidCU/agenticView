#!/usr/bin/env node
/**
 * Stdio MCP server loaded by Claude Code from the plugin's .mcp.json. It turns the user's own
 * Claude Code session into an AgenticView worker for the `claude-session` provider: the session
 * pulls queued runs from the office for its project and does them with its own tools.
 *
 * Nothing here launches `claude` or the Agent SDK. It only talks to the local office over HTTP.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { liveInstance } from "./instances.js";
import { SessionRuntime } from "./runtimes/session.js";
const workerId = SessionRuntime.newWorkerId();
let office;
let current;
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
async function post(inst, path, body, signal) {
    const res = await fetch(`${inst.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agenticview-token": inst.token, "x-agenticview-worker": workerId },
        body: JSON.stringify(body ?? {}),
        signal,
    });
    if (res.status === 401)
        throw new Error("The office rejected this worker's token (it was probably restarted). Call agenticview_next_task again.");
    if (!res.ok)
        throw new Error(`Office returned HTTP ${res.status}`);
    return (await res.json());
}
const NO_OFFICE = "No AgenticView office is running for this project (or the hub). Open it first with /agenticview, then call agenticview_next_task again. Stop looping if the user did not ask you to wait.";
export function formatTask(t) {
    const allowed = [
        t.tools.edit ? "file edits: ALLOWED" : "file edits: NOT allowed (do not use Edit/Write/MultiEdit or anything that changes files)",
        t.tools.shell ? "shell commands: ALLOWED" : "shell commands: NOT allowed (do not use Bash)",
        t.tools.web ? "web access: ALLOWED" : "web access: NOT allowed (do not use WebFetch/WebSearch)",
    ];
    const bridge = t.bridgeTools.length
        ? t.bridgeTools.map((b) => `- ${b.name}: ${b.description}\n  args schema: ${JSON.stringify(b.inputSchema)}`).join("\n")
        : "(none)";
    return [
        `# AgenticView task ${t.runId}`,
        `You are now acting as the office agent "${t.agent.name}" (${t.agent.role}${t.agent.specialty ? `, ${t.agent.specialty}` : ""}).`,
        `Working directory: ${t.cwd}`,
        `Permission mode: ${t.permissionMode}`,
        t.model ? `Requested model: ${t.model} (informational; keep using this session's model)` : "",
        t.effort ? `Requested effort: ${t.effort} (scale how thorough you are to this level)` : "",
        "",
        "## Allowed tools",
        ...allowed.map((a) => `- ${a}`),
        "",
        "## Office tools (call with agenticview_bridge {tool, args})",
        bridge,
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
async function nextTask(args) {
    if (current) {
        return reply(`You still have task ${current.runId} open. Finish it with agenticview_complete (or report an error) before taking another.`, true);
    }
    office = await discoverOffice(startDir(args.project));
    if (!office)
        return reply(NO_OFFICE, true);
    const deadline = Date.now() + Math.min(3600, Math.max(5, args.wait_seconds ?? 600)) * 1000;
    while (Date.now() < deadline) {
        const waitMs = Math.min(25_000, Math.max(1000, deadline - Date.now()));
        try {
            const { task } = await post(office, "/api/worker/claim", { waitMs }, AbortSignal.timeout(waitMs + 10_000));
            if (task) {
                current = { runId: task.runId, office };
                return reply(formatTask(task));
            }
        }
        catch {
            // Office restarted or went away: rediscover, and give up if it is gone.
            await new Promise((r) => setTimeout(r, 2000));
            office = await discoverOffice(startDir(args.project));
            if (!office)
                return reply(NO_OFFICE, true);
        }
    }
    return reply("No task arrived yet. Call agenticview_next_task again to keep waiting (the office shows this session as a connected worker while you poll).");
}
function ackText(ack, okText) {
    if (ack.ok)
        return reply(ack.result ?? okText);
    if (ack.cancelled)
        current = undefined;
    return reply(`ERROR: ${ack.error ?? "unknown error"}`, true);
}
function requireCurrent() {
    return current ?? reply("No active AgenticView task. Call agenticview_next_task first.", true);
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
export async function main() {
    const server = new McpServer({ name: "agenticview-worker", version: "0.1.0" });
    server.registerTool("agenticview_next_task", {
        description: "Wait for the next AgenticView office task assigned to the 'Claude Code session' provider and claim it. Blocks up to wait_seconds (default 600). Returns the task (agent persona, cwd, allowed tools, prompt) or a message to poll again.",
        inputSchema: {
            wait_seconds: z.number().int().min(5).max(3600).optional().describe("How long to wait for a task (default 600)"),
            project: z.string().optional().describe("Project folder whose office to serve (default: this session's folder, falling back to the hub)"),
        },
    }, async (args) => nextTask(args));
    server.registerTool("agenticview_report", {
        description: "Stream progress for the current task to the office feed. Pass a short `text` update and/or structured `events` (tool_start/tool_end with name and summary, file_changed with path and kind).",
        inputSchema: {
            text: z.string().optional().describe("A brief progress note shown in the agent's chat"),
            events: z.array(EventSchema).optional(),
        },
    }, async (args) => {
        const cur = requireCurrent();
        if ("content" in cur)
            return cur;
        const events = [...(args.text ? [{ type: "text", text: args.text }] : []), ...(args.events ?? [])];
        try {
            return ackText(await post(cur.office, `/api/worker/${cur.runId}/report`, { events }), "Reported.");
        }
        catch (e) {
            return reply(`ERROR: ${e.message}`, true);
        }
    });
    server.registerTool("agenticview_complete", {
        description: "Finish the current task. Pass `result` (the final answer shown to the user) or `error` if it could not be done. Then call agenticview_next_task again.",
        inputSchema: { result: z.string().optional(), error: z.string().optional() },
    }, async (args) => {
        const cur = requireCurrent();
        if ("content" in cur)
            return cur;
        try {
            const ack = await post(cur.office, `/api/worker/${cur.runId}/complete`, { text: args.result, error: args.error });
            current = undefined;
            return ackText(ack, "Task completed. Call agenticview_next_task for the next one.");
        }
        catch (e) {
            return reply(`ERROR: ${e.message}`, true);
        }
    });
    server.registerTool("agenticview_bridge", {
        description: "Call one of the current task's office tools (listed under 'Office tools' in the task), e.g. delegate/assign_task/await_tasks for a Manager, or report/ask tools for workers.",
        inputSchema: { tool: z.string().describe("Office tool name"), args: z.record(z.string(), z.unknown()).optional() },
    }, async (args) => {
        const cur = requireCurrent();
        if ("content" in cur)
            return cur;
        try {
            return ackText(await post(cur.office, `/api/worker/${cur.runId}/bridge`, { name: args.tool, args: args.args ?? {} }), "");
        }
        catch (e) {
            return reply(`ERROR: ${e.message}`, true);
        }
    });
    await server.connect(new StdioServerTransport());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    await main();
//# sourceMappingURL=worker-mcp.js.map