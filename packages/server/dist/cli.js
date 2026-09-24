#!/usr/bin/env node
/**
 * AgenticView CLI.
 *
 *   agenticview open --project <path> [--no-browser] [--port N]
 *   agenticview hub [--no-browser] [--port N]
 *   agenticview hook                         (stdin: Claude Code hook JSON)
 *   agenticview record-plugin-root <path>
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
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
  agenticview hook                                               (used by plugin hooks; reads stdin)
  agenticview record-plugin-root <path>                          remember where the plugin lives
  agenticview --help
`;
function globalRoot() {
    return process.env.AGENTICVIEW_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".agenticview");
}
function instanceFile(projectPath) {
    const key = projectPath ? createHash("sha1").update(resolve(projectPath).toLowerCase()).digest("hex").slice(0, 16) : "hub";
    return join(globalRoot(), "instances", `${key}.json`);
}
async function liveInstance(projectPath) {
    try {
        const inst = JSON.parse(await readFile(instanceFile(projectPath), "utf8"));
        const res = await fetch(`${inst.url}/healthz`, { signal: AbortSignal.timeout(700) });
        return res.ok ? inst : undefined;
    }
    catch {
        return undefined;
    }
}
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
    const server = await createServer({
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
    const shutdown = async () => {
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
        yield { type: "text", text: `${req.agent.name} (demo mode): received "${user.slice(0, 120)}". Set ANTHROPIC_API_KEY and start without AGENTICVIEW_FAKE to run real agents.` };
    };
    return new Map([
        ["claude", new FakeRuntime(script, "claude")],
        ["codex", new FakeRuntime(script, "codex")],
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