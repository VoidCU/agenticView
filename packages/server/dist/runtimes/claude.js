import { readFile } from "node:fs/promises";
import { extname } from "node:path";
export const CLAUDE_CREDENTIAL_ENV = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
];
export const CLAUDE_MISSING_KEY_REASON = "Claude (API) needs ANTHROPIC_API_KEY (or a cloud provider env); it does not use the Claude Code login. Max/Pro subscribers: use the \"Claude Code session\" provider by running /agenticview-work in Claude Code.";
const READ_TOOLS = ["Read", "Glob", "Grep"];
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const WEB_TOOLS = ["WebSearch", "WebFetch"];
const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export function claudeOptionsFor(req) {
    const tools = [...READ_TOOLS];
    const allowed = [...READ_TOOLS];
    const disallowed = [];
    if (req.tools.edit)
        tools.push(...EDIT_TOOLS);
    else
        disallowed.push(...EDIT_TOOLS);
    if (req.tools.shell)
        tools.push("Bash");
    else
        disallowed.push("Bash");
    if (req.tools.web)
        tools.push(...WEB_TOOLS);
    else
        disallowed.push(...WEB_TOOLS);
    for (const t of req.bridgeTools) {
        tools.push(`mcp__agenticview__${t.name}`);
        allowed.push(`mcp__agenticview__${t.name}`);
    }
    const modes = { auto: "bypassPermissions", "auto-edit": "acceptEdits", ask: "default" };
    const permissionMode = modes[req.permissionMode];
    const out = { tools, allowedTools: allowed, disallowedTools: disallowed, permissionMode };
    if (permissionMode === "bypassPermissions")
        out.allowDangerouslySkipPermissions = true;
    return out;
}
function blocksOf(msg) {
    const m = msg.message;
    const c = m?.content;
    if (typeof c === "string")
        return [{ type: "text", text: c }];
    return Array.isArray(c) ? c : [];
}
function summarize(content) {
    if (typeof content === "string")
        return content.slice(0, 200);
    if (Array.isArray(content)) {
        return content
            .map((b) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
            .join(" ")
            .trim()
            .slice(0, 200);
    }
    return "";
}
/** Pure mapping from one SDK message to zero or more RunEvents. `pending` pairs tool results with their tool_use. */
export function mapClaudeMessage(raw, pending) {
    const msg = raw;
    const out = [];
    if (!msg || typeof msg !== "object")
        return out;
    if (msg.type === "assistant") {
        for (const b of blocksOf(msg)) {
            if (b.type === "text" && typeof b.text === "string" && b.text.length > 0)
                out.push({ type: "text", text: b.text });
            else if (b.type === "tool_use") {
                const info = { name: String(b.name), input: b.input ?? {} };
                if (typeof b.id === "string")
                    pending.set(b.id, info);
                out.push({ type: "tool_start", name: info.name, input: info.input });
            }
        }
    }
    else if (msg.type === "user") {
        for (const b of blocksOf(msg)) {
            if (b.type !== "tool_result")
                continue;
            const info = typeof b.tool_use_id === "string" ? pending.get(b.tool_use_id) : undefined;
            if (typeof b.tool_use_id === "string")
                pending.delete(b.tool_use_id);
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
function resultOf(msg, text) {
    const subtype = String(msg.subtype ?? "");
    const usage = msg.usage;
    const base = {
        text: typeof msg.result === "string" && msg.result.length > 0 ? msg.result : text,
        stopReason: "done",
        sessionId: typeof msg.session_id === "string" ? msg.session_id : undefined,
        costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
        usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    };
    if (subtype === "success")
        return base;
    if (subtype === "error_max_turns")
        return { ...base, stopReason: "max_turns", error: "error_max_turns" };
    const errors = Array.isArray(msg.errors) ? msg.errors.map(String).join("; ") : "";
    return { ...base, stopReason: "error", error: errors ? `${subtype}: ${errors}` : subtype };
}
async function imageBlock(path) {
    const data = (await readFile(path)).toString("base64");
    return { type: "image", source: { type: "base64", media_type: MEDIA[extname(path).toLowerCase()] ?? "image/png", data } };
}
export class ClaudeRuntime {
    provider = "claude";
    sdk;
    apiKey;
    constructor(opts = {}) {
        this.sdk = opts.sdk;
        this.apiKey = opts.apiKey;
    }
    hasCredential() {
        return Boolean(this.apiKey) || CLAUDE_CREDENTIAL_ENV.some((k) => Boolean(process.env[k]));
    }
    async check() {
        if (this.hasCredential())
            return { provider: "claude", ok: true, version: "agent-sdk" };
        return { provider: "claude", ok: false, reason: CLAUDE_MISSING_KEY_REASON };
    }
    async loadSdk() {
        if (!this.sdk)
            this.sdk = (await import("@anthropic-ai/claude-agent-sdk"));
        return this.sdk;
    }
    async run(req, sink, signal) {
        let text = "";
        try {
            if (signal.aborted)
                return { text, stopReason: "aborted" };
            const sdk = await this.loadSdk();
            const subset = claudeOptionsFor(req);
            const abortController = new AbortController();
            const onAbort = () => abortController.abort();
            signal.addEventListener("abort", onAbort, { once: true });
            const options = {
                ...subset,
                cwd: req.cwd,
                systemPrompt: { type: "preset", preset: "claude_code", append: req.systemPrompt },
                maxTurns: req.maxTurns ?? 60,
                settingSources: ["project"],
                abortController,
            };
            if (req.sessionId)
                options.resume = req.sessionId;
            if (req.model)
                options.model = req.model;
            // The configured key goes to the SDK subprocess only, never into this process's env (other providers' CLIs inherit that).
            if (this.apiKey && !process.env.ANTHROPIC_API_KEY)
                options.env = { ...process.env, ANTHROPIC_API_KEY: this.apiKey };
            if (req.bridgeTools.length > 0) {
                const tools = req.bridgeTools.map((t) => sdk.tool(t.name, t.description, t.schema, async (args) => {
                    try {
                        return { content: [{ type: "text", text: await t.handler(args) }] };
                    }
                    catch (e) {
                        return { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true };
                    }
                }));
                options.mcpServers = { agenticview: sdk.createSdkMcpServer({ name: "agenticview", version: "0.1.0", tools: tools }) };
            }
            if (subset.permissionMode !== "bypassPermissions") {
                // `default` prompts for edits and shell; `acceptEdits` still prompts for shell. Both need a handler or the SDK denies.
                const onPermission = req.onPermission;
                options.canUseTool = async (toolName, input) => {
                    if (!onPermission)
                        return { behavior: "deny", message: "No permission handler attached in AgenticView" };
                    const id = `${req.runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                    sink({ type: "permission", id, tool: toolName, input });
                    const allow = await onPermission({ id, tool: toolName, input });
                    return allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Denied by user in AgenticView" };
                };
            }
            const content = [];
            for (const p of req.prompt) {
                if (p.type === "text")
                    content.push({ type: "text", text: p.text });
                else
                    content.push(await imageBlock(p.path));
            }
            const prompt = (async function* () {
                yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
            })();
            const pending = new Map();
            try {
                for await (const raw of sdk.query({ prompt: prompt, options: options })) {
                    const msg = raw;
                    if (msg.type === "result")
                        return resultOf(msg, text);
                    for (const ev of mapClaudeMessage(msg, pending)) {
                        if (ev.type === "text")
                            text += ev.text;
                        sink(ev);
                    }
                }
                return { text, stopReason: signal.aborted ? "aborted" : "error", error: signal.aborted ? undefined : "Agent SDK ended without a result" };
            }
            finally {
                signal.removeEventListener("abort", onAbort);
            }
        }
        catch (e) {
            if (signal.aborted)
                return { text, stopReason: "aborted" };
            return { text, stopReason: "error", error: e.message };
        }
    }
}
//# sourceMappingURL=claude.js.map