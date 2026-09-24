import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { which as defaultWhich } from "./which.js";
export const GEMINI_MISSING_REASON = "Install the Gemini CLI (npm i -g @google/gemini-cli) and sign in, or set GEMINI_API_KEY.";
const APPROVAL = { auto: "yolo", "auto-edit": "auto_edit", ask: "auto_edit" };
const WRITE_TOOLS = new Set(["write_file", "replace", "edit", "edit_file"]);
function contentText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content))
        return content.map((p) => (p && typeof p === "object" && typeof p.text === "string" ? p.text : "")).join("");
    return "";
}
/** Pure mapping from one Gemini stream-json line to RunEvents. Returns `result` when the line is the final result. */
export function mapGeminiLine(line) {
    const events = [];
    let obj;
    try {
        obj = JSON.parse(line);
    }
    catch {
        return { events: line.trim() ? [{ type: "status", text: line.trim().slice(0, 200) }] : [] };
    }
    if (!obj || typeof obj !== "object")
        return { events };
    switch (obj.type) {
        case "init":
            return { events, sessionId: typeof obj.session_id === "string" ? obj.session_id : undefined };
        case "message": {
            if (obj.role === "assistant") {
                const t = contentText(obj.content);
                if (t)
                    events.push({ type: "text", text: t });
            }
            break;
        }
        case "tool_use": {
            const name = String(obj.name ?? obj.tool_name ?? "tool");
            const input = (obj.input ?? obj.args ?? obj.parameters ?? {});
            events.push({ type: "tool_start", name, input });
            const filePath = input.file_path ?? input.path;
            if (WRITE_TOOLS.has(name) && typeof filePath === "string")
                events.push({ type: "file_changed", path: filePath, kind: name === "write_file" ? "create" : "modify" });
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
export class GeminiRuntime {
    opts;
    provider = "gemini";
    spawn;
    which;
    constructor(opts) {
        this.opts = opts;
        this.spawn = opts.spawn ?? nodeSpawn;
        this.which = opts.which ?? defaultWhich;
    }
    async check() {
        const bin = await this.which(this.opts.bin ?? "gemini");
        if (!bin)
            return { provider: "gemini", ok: false, reason: GEMINI_MISSING_REASON };
        return { provider: "gemini", ok: true, version: bin };
    }
    /** Temporarily merge the bridge MCP server into <cwd>/.gemini/settings.json; returns a restore function. */
    async installBridgeSettings(req) {
        const dir = join(req.cwd, ".gemini");
        const file = join(dir, "settings.json");
        let original;
        let dirExisted = true;
        try {
            original = await readFile(file, "utf8");
        }
        catch {
            original = undefined;
        }
        try {
            await mkdir(dir, { recursive: false });
            dirExisted = false;
        }
        catch {
            dirExisted = true;
        }
        let settings = {};
        if (original) {
            try {
                settings = JSON.parse(original);
            }
            catch {
                settings = {};
            }
        }
        const servers = { ...(settings.mcpServers ?? {}) };
        servers.agenticview = {
            command: process.execPath,
            args: [this.opts.bridgeEntry],
            env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
            trust: true,
        };
        await writeFile(file, JSON.stringify({ ...settings, mcpServers: servers }, null, 2), "utf8");
        return async () => {
            if (original !== undefined)
                await writeFile(file, original, "utf8");
            else {
                await rm(file, { force: true });
                if (!dirExisted)
                    await rmdir(dir).catch(() => undefined);
            }
        };
    }
    async run(req, sink, signal) {
        let text = "";
        let sessionId = req.sessionId;
        if (signal.aborted)
            return { text, stopReason: "aborted" };
        const useBridge = req.bridgeTools.length > 0;
        const restore = useBridge ? await this.installBridgeSettings(req) : async () => undefined;
        let child;
        const onAbort = () => child?.kill();
        try {
            const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
            const images = req.prompt.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.path : ""));
            const promptText = [req.systemPrompt, ...textParts, images.length ? `Attached images:\n${images.map((i) => `@${i}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
            const args = ["-p", promptText, "--output-format", "stream-json", "--approval-mode", APPROVAL[req.permissionMode]];
            if (req.model)
                args.push("-m", req.model);
            if (req.sessionId)
                args.push("--resume", req.sessionId);
            if (useBridge)
                args.push("--allowed-mcp-server-names", "agenticview");
            const env = {};
            for (const [k, v] of Object.entries(process.env))
                if (typeof v === "string")
                    env[k] = v;
            if (this.opts.apiKey && !env.GEMINI_API_KEY)
                env.GEMINI_API_KEY = this.opts.apiKey;
            child = this.spawn(this.opts.bin ?? "gemini", args, { cwd: req.cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            signal.addEventListener("abort", onAbort, { once: true });
            const stderr = [];
            child.stderr?.on("data", (d) => {
                for (const l of String(d).split(/\r?\n/))
                    if (l.trim())
                        stderr.push(l);
                if (stderr.length > 200)
                    stderr.splice(0, stderr.length - 200);
            });
            let final;
            const rl = createInterface({ input: child.stdout });
            const exit = new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", (code) => resolve(code));
            });
            for await (const line of rl) {
                const m = mapGeminiLine(line);
                if (m.sessionId)
                    sessionId = m.sessionId;
                if (m.result)
                    final = m.result;
                for (const ev of m.events) {
                    if (ev.type === "text")
                        text += ev.text;
                    sink(ev);
                }
            }
            const code = await exit;
            if (signal.aborted)
                return { text, stopReason: "aborted", sessionId };
            if (code === 53)
                return { text, stopReason: "max_turns", error: "turn limit exceeded", sessionId };
            if (code !== 0)
                return { text, stopReason: "error", error: `gemini exited with ${code}: ${stderr.slice(-20).join("\n")}`, sessionId };
            if (final && !final.ok)
                return { text, stopReason: "error", error: final.error, sessionId };
            return { text, stopReason: "done", sessionId };
        }
        catch (e) {
            if (signal.aborted)
                return { text, stopReason: "aborted", sessionId };
            return { text, stopReason: "error", error: e.message, sessionId };
        }
        finally {
            signal.removeEventListener("abort", onAbort);
            await restore();
        }
    }
}
//# sourceMappingURL=gemini.js.map