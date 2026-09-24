import { which as defaultWhich } from "./which.js";
export const CODEX_MISSING_REASON = "Install the Codex CLI (npm i -g @openai/codex) and sign in with `codex login` or set CODEX_API_KEY.";
/**
 * Permission mode → Codex sandbox. `ask` cannot prompt through the SDK, so it is read-only (the most
 * restrictive setting). Codex's Windows sandbox cannot write files, so `auto-edit` needs full access there.
 */
export function sandboxFor(mode, platform = process.platform) {
    if (mode === "ask")
        return "read-only";
    if (mode === "auto")
        return "danger-full-access";
    return platform === "win32" ? "danger-full-access" : "workspace-write";
}
function textOf(blocks) {
    if (!Array.isArray(blocks))
        return "";
    return blocks
        .map((b) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
        .join(" ")
        .trim();
}
/** Pure mapping from Codex thread events to RunEvents. `started` tracks tool items that already emitted tool_start. */
export function mapCodexEvent(ev, started) {
    const out = [];
    if (ev.type !== "item.started" && ev.type !== "item.completed")
        return out;
    const item = ev.item;
    const id = item.id ?? `${item.type}-${Math.random()}`;
    const start = (name, input) => {
        if (started.has(id))
            return;
        started.add(id);
        out.push({ type: "tool_start", name, input });
    };
    switch (item.type) {
        case "reasoning":
            if (ev.type === "item.started")
                out.push({ type: "status", text: "thinking" });
            break;
        case "agent_message":
            if (ev.type === "item.completed" && item.text)
                out.push({ type: "text", text: item.text });
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
            if (ev.type === "item.completed")
                out.push({ type: "tool_end", name: "web_search", ok: true, summary: item.query });
            break;
        case "error":
            if (ev.type === "item.completed")
                out.push({ type: "status", text: `error: ${item.message}` });
            break;
        default:
            break;
    }
    return out;
}
export class CodexRuntime {
    opts;
    provider = "codex";
    sdk;
    which;
    constructor(opts) {
        this.opts = opts;
        this.sdk = opts.sdk;
        this.which = opts.which ?? defaultWhich;
    }
    async check() {
        const bin = await this.which("codex");
        if (!bin)
            return { provider: "codex", ok: false, reason: CODEX_MISSING_REASON };
        return { provider: "codex", ok: true, version: bin };
    }
    async loadSdk() {
        if (!this.sdk)
            this.sdk = (await import("@openai/codex-sdk"));
        return this.sdk;
    }
    async run(req, sink, signal) {
        let text = "";
        let sessionId = req.sessionId;
        try {
            if (signal.aborted)
                return { text, stopReason: "aborted" };
            const sdk = await this.loadSdk();
            const env = {};
            for (const [k, v] of Object.entries(process.env))
                if (typeof v === "string")
                    env[k] = v;
            if (this.opts.apiKey && !env.CODEX_API_KEY)
                env.CODEX_API_KEY = this.opts.apiKey;
            const config = { approval_policy: "never" };
            if (req.bridgeTools.length > 0) {
                config.mcp_servers = {
                    agenticview: {
                        command: process.execPath,
                        args: [this.opts.bridgeEntry],
                        env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
                    },
                };
            }
            const codex = new sdk.Codex({ env, config: config });
            const threadOpts = { workingDirectory: req.cwd, skipGitRepoCheck: true, sandboxMode: sandboxFor(req.permissionMode), ...(req.model ? { model: req.model } : {}) };
            const thread = req.sessionId ? codex.resumeThread(req.sessionId, threadOpts) : codex.startThread(threadOpts);
            const input = [];
            const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
            input.push({ type: "text", text: [req.systemPrompt, ...textParts].filter(Boolean).join("\n\n") });
            for (const p of req.prompt)
                if (p.type === "image")
                    input.push({ type: "local_image", path: p.path });
            const { events } = await thread.runStreamed(input, { signal });
            const started = new Set();
            let failure;
            let usage;
            for await (const ev of events) {
                if (signal.aborted)
                    return { text, stopReason: "aborted", sessionId };
                if (ev.type === "thread.started")
                    sessionId = ev.thread_id;
                else if (ev.type === "turn.completed")
                    usage = { inputTokens: ev.usage?.input_tokens ?? 0, outputTokens: ev.usage?.output_tokens ?? 0 };
                else if (ev.type === "turn.failed")
                    failure = ev.error?.message ?? "turn failed";
                else if (ev.type === "error")
                    failure = ev.message;
                for (const mapped of mapCodexEvent(ev, started)) {
                    if (mapped.type === "text")
                        text += mapped.text;
                    sink(mapped);
                }
            }
            sessionId = thread.id ?? sessionId;
            if (failure)
                return { text, stopReason: "error", error: failure, sessionId, usage };
            return { text, stopReason: "done", sessionId, usage };
        }
        catch (e) {
            if (signal.aborted)
                return { text, stopReason: "aborted", sessionId };
            return { text, stopReason: "error", error: e.message, sessionId };
        }
    }
}
//# sourceMappingURL=codex.js.map