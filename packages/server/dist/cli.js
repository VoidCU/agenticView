#!/usr/bin/env node
/**
 * AgenticView CLI.
 *
 *   agenticview open --project <path> [--no-browser] [--port N]
 *   agenticview hub [--no-browser] [--port N]
 *   agenticview close [--project <path> | --hub | --all]
 *   agenticview hook                        (stdin: Claude Code hook JSON)
 *   agenticview record-plugin-root <path>
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { instanceFile, instancesRoot, liveInstance } from "./instances.js";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");
const hookScript = join(repoRoot, "hooks", "hook.mjs");
const webDist = join(repoRoot, "packages", "web", "dist");
export const USAGE = `AgenticView — a 3D office for your coding agents

Usage:
  agenticview open --project <path> [--no-browser] [--port N]   open the office for a project
  agenticview hub [--no-browser] [--port N]                      open the global hub
  agenticview close [--project <path> | --hub | --all]           close a running office (default: this folder's)
  agenticview hook                                               (used by plugin hooks; reads stdin)
  agenticview record-plugin-root <path>                          remember where the plugin lives
  agenticview --help
`;
export function openBrowser(url) {
    try {
        const child = process.platform === "win32"
            ? spawn("cmd", ["/c", "start", "", url.replace(/&/g, "^&")], { detached: true, stdio: "ignore" })
            : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
        child.on("error", () => undefined);
        child.unref();
    }
    catch {
        /* non-fatal */
    }
}
function launchUrl(inst) {
    return `${inst.url}/#token=${inst.token}`;
}
async function assertProjectDir(projectPath) {
    try {
        if (!(await stat(projectPath)).isDirectory())
            throw new Error(`${projectPath} is not a directory`);
    }
    catch (e) {
        if (e.code === "ENOENT")
            throw new Error(`${projectPath} does not exist`);
        throw e;
    }
}
async function startWorld(projectPath, opts) {
    if (projectPath)
        await assertProjectDir(projectPath);
    const existing = await liveInstance(projectPath);
    if (existing) {
        console.log(`AgenticView: ${launchUrl(existing)}`);
        if (opts.browser)
            openBrowser(launchUrl(existing));
        return;
    }
    const { createServer } = await import("./server.js");
    const token = randomBytes(16).toString("hex");
    let shutdown = async () => undefined;
    const server = await createServer({
        onShutdown: () => void shutdown(),
        world: projectPath ? { kind: "project", projectPath } : { kind: "hub" },
        token,
        port: opts.port,
        runtimes: process.env.AGENTICVIEW_FAKE ? await demoRuntimes() : undefined,
        staticDir: existsSync(webDist) ? webDist : undefined,
        openProject: (path) => openProjectDetached(path),
    });
    const file = instanceFile(projectPath);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const inst = { pid: process.pid, url: server.url, token, projectPath, startedAt: new Date().toISOString() };
    // The instance file carries the launch token: owner-only on POSIX (mode is ignored on Windows).
    await writeFile(file, JSON.stringify(inst, null, 2), { encoding: "utf8", mode: 0o600 });
    console.log(`AgenticView: ${launchUrl(inst)}`);
    if (opts.browser)
        openBrowser(launchUrl(inst));
    shutdown = async () => {
        // Open browser tabs keep sockets alive; never let a slow close keep the process around.
        setTimeout(() => process.exit(0), 3000).unref();
        await unlink(file).catch(() => undefined);
        await server.close().catch(() => undefined);
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGHUP", () => void shutdown());
    await new Promise(() => undefined);
}
/** AGENTICVIEW_FAKE=1: scripted runtimes that echo the prompt, for demos and UI smoke tests. */
async function demoRuntimes() {
    const { FakeRuntime } = await import("./runtimes/fake.js");
    const script = async function* (req) {
        const text = req.prompt.map((p) => (p.type === "text" ? p.text ?? "" : "")).join(" ");
        const user = text.includes("## User request") ? text.split("## User request")[1].trim() : text;
        yield { type: "status", text: "thinking" };
        await new Promise((r) => setTimeout(r, 400));
        if (req.agent.role === "manager") {
            // Exercise the real Manager bridge tools so the office animates: "move <worker> to <space>" reseats,
            // anything else hands a demo task to the first worker on the roster.
            const move = /move\s+(\S+)\s+to\s+(.+)$/i.exec(user);
            const firstWorker = /^- (w_\w+) "/m.exec(text)?.[1];
            if (move)
                yield { type: "call", tool: "move_worker", args: { agent: move[1], space: move[2].trim() } };
            else if (firstWorker)
                yield { type: "call", tool: "assign_task", args: { agentId: firstWorker, title: user.slice(0, 80) || "Demo task", description: user || "Demo task" } };
        }
        yield { type: "text", text: `${req.agent.name} (demo mode): received "${user.slice(0, 120)}". Set ANTHROPIC_API_KEY and start without AGENTICVIEW_FAKE to run real agents.` };
    };
    return new Map([
        ["claude", new FakeRuntime(script, "claude")],
        ["claude-session", new FakeRuntime(script, "claude-session")],
        ["codex", new FakeRuntime(script, "codex")],
        ["antigravity", new FakeRuntime(script, "antigravity")],
        ["gemini", new FakeRuntime(script, "gemini")],
    ]);
}
/** Hub: open a project world in its own detached process and return its URL once it is healthy. */
async function openProjectDetached(projectPath) {
    const existing = await liveInstance(projectPath);
    if (existing)
        return launchUrl(existing);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "open", "--project", projectPath, "--no-browser"], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        const inst = await liveInstance(projectPath);
        if (inst)
            return launchUrl(inst);
    }
    throw new Error(`Timed out starting AgenticView for ${projectPath}`);
}
function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === "EPERM";
    }
}
/** Stop one recorded office: ask it to shut down over its token-guarded API, fall back to killing its pid. */
async function closeInstance(file) {
    let inst;
    try {
        inst = JSON.parse(await readFile(file, "utf8"));
    }
    catch {
        return undefined;
    }
    const label = inst.projectPath ?? "hub";
    if (!alive(inst.pid)) {
        // Left behind by a crash: tidy it up, nothing to close.
        await unlink(file).catch(() => undefined);
        return undefined;
    }
    try {
        await fetch(`${inst.url}/api/shutdown`, { method: "POST", headers: { "x-agenticview-token": inst.token }, signal: AbortSignal.timeout(2000) });
    }
    catch {
        // Not answering: stale file or a hung server; the pid check below decides.
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && alive(inst.pid))
        await new Promise((r) => setTimeout(r, 150));
    if (alive(inst.pid)) {
        try {
            process.kill(inst.pid);
        }
        catch {
            // Already gone.
        }
    }
    await unlink(file).catch(() => undefined);
    return label;
}
async function closeCommand(rest) {
    const { values } = parseArgs({ args: rest, options: { project: { type: "string" }, hub: { type: "boolean" }, all: { type: "boolean" }, yes: { type: "boolean" } }, strict: false });
    let files;
    if (values.all) {
        const dir = join(instancesRoot(), "instances");
        files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
        if (!values.yes) {
            // Dry-run: show what would be closed and require --yes to proceed.
            const labels = [];
            for (const f of files) {
                let inst;
                try {
                    inst = JSON.parse(await readFile(f, "utf8"));
                }
                catch {
                    continue;
                }
                if (!alive(inst.pid))
                    continue;
                labels.push(inst.projectPath ?? "hub");
            }
            if (labels.length === 0) {
                console.log("AgenticView: no offices are running.");
            }
            else {
                console.log("AgenticView: --all will close:");
                for (const l of labels)
                    console.log(`  ${l}`);
                console.log("Re-run with --yes to confirm.");
            }
            return 1;
        }
    }
    else if (values.hub) {
        files = [instanceFile(null)];
    }
    else {
        files = [instanceFile(typeof values.project === "string" && values.project ? resolve(values.project) : process.cwd())];
    }
    const closed = [];
    for (const f of files) {
        const label = await closeInstance(f);
        if (label)
            closed.push(label);
    }
    if (closed.length === 0) {
        console.log(values.all ? "AgenticView: no offices are running." : "AgenticView: no office is running for that folder.");
        return 0;
    }
    for (const c of closed)
        console.log(`AgenticView: closed ${c}`);
    return 0;
}
export async function main(argv) {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
        console.log(USAGE);
        return 0;
    }
    if (cmd === "hook") {
        const { runHook } = (await import(pathToFileURL(hookScript).href));
        return runHook(["mirror"]);
    }
    if (cmd === "record-plugin-root") {
        const { runHook } = (await import(pathToFileURL(hookScript).href));
        return runHook(["record-root", rest[0] ?? ""]);
    }
    if (cmd === "close")
        return closeCommand(rest);
    if (cmd === "open" || cmd === "hub") {
        const { values } = parseArgs({
            args: rest,
            options: { project: { type: "string" }, browser: { type: "boolean", default: true }, port: { type: "string" } },
            allowNegative: true,
            strict: false,
        });
        const port = values.port ? Number(values.port) : undefined;
        if (cmd === "open") {
            const project = typeof values.project === "string" && values.project ? resolve(values.project) : process.cwd();
            await startWorld(project, { browser: values.browser !== false, port });
        }
        else {
            await startWorld(null, { browser: values.browser !== false, port });
        }
        return 0;
    }
    console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
    return 1;
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main(process.argv.slice(2)).then((code) => {
        if (code !== 0)
            process.exit(code);
        if (process.argv[2] !== "open" && process.argv[2] !== "hub")
            process.exit(0);
    }, (e) => {
        console.error(`AgenticView failed: ${e.message}`);
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map