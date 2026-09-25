import { spawn as nodeSpawn } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { which as defaultWhich } from "./which.js";
export const ANTIGRAVITY_MISSING_REASON = "Install the Antigravity CLI (agy) and sign in by running `agy` once.";
const PLUGIN_PREFIX = "agenticview-";
const SERVER_NAME = "agenticview";
const PLUGIN_MARKER = "agenticview-managed";
/** Prompts longer than this are written to a file; Windows limits a command line to 32 K characters. */
const MAX_ARG_PROMPT = 30_000;
const AGY_EFFORTS = new Set(["low", "medium", "high", "max"]);
const CREATE_TOOLS = new Set(["write_to_file"]);
const MODIFY_TOOLS = new Set(["replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]);
/**
 * Permission handling (verified against agy 1.2.11 in headless `-p` mode):
 * - default mode auto-approves file edits inside the workspace and denies shell commands;
 * - `--mode accept-edits` behaves the same headless (edits yes, commands denied);
 * - `--mode plan` makes the agent plan first and denies commands (it can still write files when told to);
 * - `--dangerously-skip-permissions` approves everything.
 * So: ask -> default, auto-edit -> accept-edits, auto -> skip permissions (unless the agent may not use
 * the shell, then accept-edits), and read-only agents (no edit, no shell) -> plan.
 */
export function modeArgs(mode, tools) {
    if (!tools.edit && !tools.shell)
        return ["--mode", "plan"];
    if (mode === "auto")
        return tools.shell ? ["--dangerously-skip-permissions"] : ["--mode", "accept-edits"];
    if (mode === "auto-edit")
        return ["--mode", "accept-edits"];
    return [];
}
export function buildAgyArgs(input) {
    const args = ["-p", input.prompt, "--output-format", "stream-json", "--disable-slash-commands"];
    if (input.model)
        args.push("--model", input.model);
    if (input.effort && AGY_EFFORTS.has(input.effort))
        args.push("--effort", input.effort);
    if (input.sessionId)
        args.push("--conversation", input.sessionId);
    args.push(...modeArgs(input.permissionMode, input.tools));
    return args;
}
/** Plain-language limits for allowances agy has no flag for; appended to the prompt. */
export function allowanceNotes(tools) {
    const out = [];
    if (!tools.edit)
        out.push("Do not create, edit or delete files.");
    if (!tools.shell)
        out.push("Do not run shell commands.");
    if (!tools.web)
        out.push("Do not search the web or fetch URLs.");
    return out;
}
export function newAgyMapState() {
    return { text: new Map(), started: new Set() };
}
function str(v) {
    return typeof v === "string" ? v : undefined;
}
function toolName(info, fallback) {
    if ((info.name ?? fallback) === "call_mcp_tool")
        return str(info.parameters?.ToolName) ?? "call_mcp_tool";
    return info.name ?? fallback;
}
function toolInput(info) {
    if (info.name === "call_mcp_tool")
        return info.parameters?.Arguments ?? {};
    return info.parameters ?? {};
}
function filePathOf(params) {
    if (!params)
        return undefined;
    return str(params.TargetFile) ?? str(params.AbsolutePath) ?? str(params.FilePath) ?? str(params.path);
}
function flush(state, index, events) {
    const t = state.text.get(index);
    state.text.delete(index);
    if (t && t.trim())
        events.push({ type: "text", text: t });
}
/** Flush all buffered text (end of stream). */
export function flushAgyText(state) {
    const events = [];
    for (const i of [...state.text.keys()].sort((a, b) => a - b))
        flush(state, i, events);
    return events;
}
/**
 * Pure mapping from one agy stream-json line to RunEvents. agent_response text arrives as small
 * `text_delta` chunks; they are buffered per step and emitted as one text event when the step is
 * DONE (or when another step starts), so the office feed gets whole messages.
 */
export function mapAgyLine(line, state) {
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
    switch (obj.event) {
        case "init":
            return { events, sessionId: str(obj.conversation_id) || undefined };
        case "step_update": {
            const s = (obj.step_update ?? {});
            const index = typeof s.step_index === "number" ? s.step_index : -1;
            // DONE, ERROR (a failed or denied tool), CANCELED, ...: anything but ACTIVE ends the step.
            const done = typeof s.state === "string" && s.state !== "ACTIVE";
            // A new step means earlier text steps are finished.
            for (const k of [...state.text.keys()])
                if (k !== index)
                    flush(state, k, events);
            if (s.step_type === "agent_response") {
                const delta = str(s.text_delta);
                if (delta)
                    state.text.set(index, (state.text.get(index) ?? "") + delta);
                if (done)
                    flush(state, index, events);
                break;
            }
            if (s.step_type === "tool") {
                const info = (s.tool_info ?? {});
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
                        if (CREATE_TOOLS.has(raw))
                            events.push({ type: "file_changed", path, kind: "create" });
                        else if (MODIFY_TOOLS.has(raw))
                            events.push({ type: "file_changed", path, kind: "modify" });
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
            const r = (obj.result ?? {});
            const ok = r.status === "SUCCESS";
            const denied = Array.isArray(r.denied_actions) ? r.denied_actions : [];
            if (denied.length > 0)
                events.push({ type: "status", text: `denied: ${denied.map((d) => str(d.display_name) ?? str(d.action) ?? "action").join(", ")}` });
            const u = (r.usage ?? {});
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
export function pluginName(runId) {
    return `${PLUGIN_PREFIX}${runId}`;
}
/** The MCP server name agy shows for the bridge (`<plugin>_<server>`). */
export function bridgeServerName(runId) {
    return `${pluginName(runId)}_${SERVER_NAME}`;
}
async function exists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Write `<cwd>/.agents/plugins/agenticview-<runId>/` (plugin.json + mcp_config.json). Returns a
 * function that removes it again, plus `.agents/plugins` and `.agents` when this run created them
 * and they are empty, plus agy's tool-schema cache for the server.
 */
export async function installBridgePlugin(cwd, runId, server, home = homedir()) {
    const agentsDir = join(cwd, ".agents");
    const pluginsDir = join(agentsDir, "plugins");
    const dir = join(pluginsDir, pluginName(runId));
    const createdAgents = !(await exists(agentsDir));
    const createdPlugins = !(await exists(pluginsDir));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "plugin.json"), JSON.stringify({ name: pluginName(runId), description: "AgenticView bridge tools for one run (removed when the run ends).", [PLUGIN_MARKER]: true }, null, 2), "utf8");
    await writeFile(join(dir, "mcp_config.json"), JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2), "utf8");
    return async () => {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        if (createdPlugins)
            await rmdir(pluginsDir).catch(() => undefined);
        if (createdAgents)
            await rmdir(agentsDir).catch(() => undefined);
        await rm(join(home, ".gemini", "antigravity-cli", "mcp", bridgeServerName(runId)), { recursive: true, force: true }).catch(() => undefined);
    };
}
/**
 * Boot-time repair: remove bridge plugins a crashed server left in `<project>/.agents/plugins`, and
 * agy schema caches for AgenticView servers older than a day (other projects may still be running).
 */
export async function cleanupAntigravityPlugins(projectPath, home = homedir()) {
    const pluginsDir = join(projectPath, ".agents", "plugins");
    let names = [];
    try {
        names = await readdir(pluginsDir);
    }
    catch {
        names = [];
    }
    let removed = false;
    for (const n of names) {
        if (!n.startsWith(PLUGIN_PREFIX))
            continue;
        try {
            const manifest = JSON.parse(await readFile(join(pluginsDir, n, "plugin.json"), "utf8"));
            if (manifest[PLUGIN_MARKER] !== true)
                continue;
        }
        catch {
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
    let cached = [];
    try {
        cached = await readdir(cache);
    }
    catch {
        return;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const n of cached) {
        if (!n.startsWith(PLUGIN_PREFIX) || !n.endsWith(`_${SERVER_NAME}`))
            continue;
        try {
            if ((await stat(join(cache, n))).mtimeMs < cutoff)
                await rm(join(cache, n), { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
    }
}
/* ------------------------------------------------------------------------------------------ */
/* Runtime                                                                                     */
/* ------------------------------------------------------------------------------------------ */
/** Kill a process and its children. On Windows `child.kill()` leaves agy's helpers running. */
export function killTree(child, platform = process.platform, spawn = nodeSpawn) {
    if (child.exitCode !== null || child.pid === undefined)
        return;
    if (platform === "win32") {
        try {
            const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
            k.on("error", () => child.kill());
            return;
        }
        catch {
            /* fall through */
        }
    }
    child.kill();
}
export class AntigravityRuntime {
    opts;
    provider = "antigravity";
    spawn;
    which;
    platform;
    env;
    home;
    constructor(opts) {
        this.opts = opts;
        this.spawn = opts.spawn ?? nodeSpawn;
        this.which = opts.which ?? defaultWhich;
        this.platform = opts.platform ?? process.platform;
        this.env = opts.env ?? process.env;
        this.home = opts.home ?? homedir();
    }
    /** agy on PATH, else the default Windows install location (%LOCALAPPDATA%\agy\bin\agy.exe). */
    async locate() {
        const onPath = await this.which(this.opts.bin ?? "agy");
        if (onPath)
            return onPath;
        const local = this.env.LOCALAPPDATA;
        if (this.platform === "win32" && local) {
            const exe = join(local, "agy", "bin", "agy.exe");
            if (await exists(exe))
                return exe;
        }
        return undefined;
    }
    version(bin) {
        return new Promise((resolve) => {
            let out = "";
            let child;
            try {
                child = this.spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
            }
            catch {
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
    async check() {
        const bin = await this.locate();
        if (!bin)
            return { provider: "antigravity", ok: false, reason: ANTIGRAVITY_MISSING_REASON };
        const v = await this.version(bin);
        return { provider: "antigravity", ok: true, version: v ? `agy ${v} (${bin})` : bin };
    }
    async run(req, sink, signal) {
        let text = "";
        let sessionId = req.sessionId;
        if (signal.aborted)
            return { text, stopReason: "aborted" };
        const useBridge = req.bridgeTools.length > 0;
        let restore = async () => undefined;
        let promptFile;
        let child;
        const onAbort = () => {
            if (child)
                killTree(child, this.platform, this.spawn);
        };
        try {
            if (useBridge) {
                restore = await installBridgePlugin(req.cwd, req.runId, {
                    command: process.execPath,
                    args: [this.opts.bridgeEntry],
                    env: { AGENTICVIEW_BRIDGE_URL: this.opts.bridgeUrl(), AGENTICVIEW_RUN_ID: req.runId, AGENTICVIEW_BRIDGE_TOKEN: req.bridgeToken ?? "" },
                }, this.home);
            }
            const textParts = req.prompt.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
            const images = req.prompt.filter((p) => p.type === "image").map((p) => (p.type === "image" ? p.path : ""));
            const notes = allowanceNotes(req.tools);
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
            const args = buildAgyArgs({ prompt: promptText, model: req.model, effort: req.effort, sessionId: req.sessionId, permissionMode: req.permissionMode, tools: req.tools });
            const env = {};
            for (const [k, v] of Object.entries(process.env))
                if (typeof v === "string")
                    env[k] = v;
            const bin = (await this.locate()) ?? this.opts.bin ?? "agy";
            child = this.spawn(bin, args, { cwd: req.cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            signal.addEventListener("abort", onAbort, { once: true });
            const stderr = [];
            child.stderr?.on("data", (d) => {
                for (const l of String(d).split(/\r?\n/))
                    if (l.trim())
                        stderr.push(l);
                if (stderr.length > 200)
                    stderr.splice(0, stderr.length - 200);
            });
            const exit = new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("close", (code) => resolve(code));
            });
            const state = newAgyMapState();
            let final;
            const emit = (ev) => {
                if (ev.type === "text")
                    text += (text ? "\n\n" : "") + ev.text;
                sink(ev);
            };
            const rl = createInterface({ input: child.stdout });
            for await (const line of rl) {
                const m = mapAgyLine(line, state);
                if (m.sessionId)
                    sessionId = m.sessionId;
                if (m.result)
                    final = m.result;
                m.events.forEach(emit);
            }
            flushAgyText(state).forEach(emit);
            const code = await exit;
            if (signal.aborted)
                return { text, stopReason: "aborted", sessionId };
            if (!text && final?.response)
                text = final.response;
            if (final && !final.ok)
                return { text, stopReason: "error", error: final.error, sessionId, usage: final.usage };
            if (code !== 0)
                return { text, stopReason: "error", error: `agy exited with ${code}: ${stderr.slice(-20).join("\n")}`, sessionId, usage: final?.usage };
            if (!final)
                return { text, stopReason: "error", error: `agy ended without a result${stderr.length ? `: ${stderr.slice(-20).join("\n")}` : ""}`, sessionId };
            return { text, stopReason: "done", sessionId, usage: final.usage };
        }
        catch (e) {
            if (signal.aborted)
                return { text, stopReason: "aborted", sessionId };
            return { text, stopReason: "error", error: e.message, sessionId };
        }
        finally {
            signal.removeEventListener("abort", onAbort);
            await restore();
            if (promptFile)
                await rm(promptFile, { force: true }).catch(() => undefined);
        }
    }
}
//# sourceMappingURL=antigravity.js.map